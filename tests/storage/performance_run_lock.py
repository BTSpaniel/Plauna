# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

"""Serialize native performance runs without suppressing their internal load."""
from contextlib import contextmanager
from pathlib import Path
import os
import time


def _windows_byte_lock(stream):
    """Lock byte zero on a synchronous CRT file handle, without polling.

    ULONG_PTR is pointer-sized; DWORD remains 32-bit on 64-bit Windows.
    The offset/pointer union and zero event match the native OVERLAPPED ABI.
    These functions borrow the stream handle and never close it themselves.
    """
    import ctypes
    from ctypes import wintypes
    import msvcrt

    class Offset(ctypes.Structure):
        _fields_ = [('Offset', wintypes.DWORD), ('OffsetHigh', wintypes.DWORD)]

    class OffsetOrPointer(ctypes.Union):
        _fields_ = [('position', Offset), ('Pointer', ctypes.c_void_p)]

    class Overlapped(ctypes.Structure):
        _fields_ = [('Internal', ctypes.c_size_t), ('InternalHigh', ctypes.c_size_t),
                    ('offset', OffsetOrPointer), ('hEvent', wintypes.HANDLE)]

    pointer_bytes = ctypes.sizeof(ctypes.c_void_p)
    if (ctypes.sizeof(wintypes.DWORD) != 4
            or ctypes.sizeof(Overlapped) != 3 * pointer_bytes + 8
            or Overlapped.InternalHigh.offset != pointer_bytes
            or Overlapped.offset.offset != 2 * pointer_bytes
            or Overlapped.hEvent.offset != 2 * pointer_bytes + 8):
        raise RuntimeError('Unexpected Windows OVERLAPPED ABI for the performance lock')
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    lock = kernel.LockFileEx
    lock.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.DWORD,
                     wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(Overlapped)]
    lock.restype = wintypes.BOOL
    unlock = kernel.UnlockFileEx
    unlock.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.DWORD,
                       wintypes.DWORD, ctypes.POINTER(Overlapped)]
    unlock.restype = wintypes.BOOL
    handle = msvcrt.get_osfhandle(stream.fileno())
    acquire_request, release_request = Overlapped(), Overlapped()

    def acquire():
        # Normal Python open() creates a synchronous file handle. Omitting
        # FAIL_IMMEDIATELY makes the kernel wait for this exact byte range.
        # Every failure is surfaced once, including unexpected IO_PENDING.
        if not lock(handle, 0x00000002, 0, 1, 0, ctypes.byref(acquire_request)):
            raise ctypes.WinError(ctypes.get_last_error())

    def release():
        if not unlock(handle, 0, 1, 0, ctypes.byref(release_request)):
            raise ctypes.WinError(ctypes.get_last_error())

    return acquire, release


@contextmanager
def performance_run_lock(root: Path):
    # Immutable validation snapshots must still serialize against their source
    # workspace's reference machine, rather than creating independent locks.
    reference_root = Path(os.environ.get('WEBGPU_OS_PERFORMANCE_LOCK_ROOT') or root).resolve()
    path = reference_root / 'tmp' / 'ai-heavy-workload-implementation-2026-09-08' / 'benchmark.lock'
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('a+b') as stream:
        if stream.tell() == 0:
            stream.write(b'\0')
            stream.flush()
        if os.name == 'nt':
            acquire, release = _windows_byte_lock(stream)
            backend = 'Windows blocking exclusive byte 0'
        else:
            import fcntl

            def acquire():
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX)

            def release():
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)

            backend = 'POSIX blocking exclusive flock'
        started = time.perf_counter()
        print(f'Acquiring shared performance reference machine: {backend}; {path}', flush=True)
        try:
            acquire()
        except OSError as error:
            elapsed_ms = (time.perf_counter() - started) * 1000
            print(f'Shared performance lock acquisition failed after {elapsed_ms:.3f} ms: {error}', flush=True)
            raise
        acquired = time.perf_counter()
        print(f'Shared performance lock acquired after {(acquired - started) * 1000:.3f} ms.', flush=True)
        try:
            yield
        finally:
            release()
            print(f'Shared performance lock released after {(time.perf_counter() - acquired) * 1000:.3f} ms held.', flush=True)
