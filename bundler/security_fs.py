# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Confine filesystem operations to held, non-redirected directory handles."""

from __future__ import annotations

import contextlib
import ctypes
import os
from pathlib import Path, PurePosixPath
import secrets
import stat


class UnsafePathError(ValueError):
    """A path redirects, escapes its root, or has unsafe secret permissions."""


def _parts(relative):
    value = str(relative).replace('\\', '/')
    if value in ('', '.'):
        return ()
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in ('', '.', '..') or ':' in part or '\x00' in part
                                 for part in value.split('/')):
        raise UnsafePathError('Filesystem path must be a relative path without traversal')
    if os.name == 'nt':
        devices = {'CON', 'PRN', 'AUX', 'NUL', 'CONIN$', 'CONOUT$'}
        devices.update(prefix + digit for prefix in ('COM', 'LPT') for digit in '123456789¹²³')
        if any(part.endswith(('.', ' ')) or part.split('.')[0].upper() in devices
               or any(ord(character) < 32 for character in part) for part in path.parts):
            raise UnsafePathError('Windows device names and ambiguous path aliases are refused')
    return path.parts


if os.name == 'nt':
    from ctypes import wintypes
    import msvcrt

    _kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    _security = ctypes.WinDLL('advapi32', use_last_error=True)
    _native = ctypes.WinDLL('ntdll')
    _kernel.CreateFileW.argtypes = (wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                                    ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE)
    _kernel.CreateFileW.restype = wintypes.HANDLE
    _kernel.CloseHandle.argtypes = (wintypes.HANDLE,)
    _kernel.GetCurrentProcess.restype = wintypes.HANDLE
    _kernel.DuplicateHandle.argtypes = (wintypes.HANDLE, wintypes.HANDLE, wintypes.HANDLE,
        ctypes.POINTER(wintypes.HANDLE), wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
    _kernel.LocalFree.argtypes = (ctypes.c_void_p,)
    _kernel.GetFileInformationByHandleEx.argtypes = (wintypes.HANDLE, ctypes.c_int,
                                                     ctypes.c_void_p, wintypes.DWORD)
    _kernel.CreateDirectoryW.argtypes = (wintypes.LPCWSTR, ctypes.c_void_p)
    _security.OpenProcessToken.argtypes = (wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE))
    _security.GetTokenInformation.argtypes = (wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p,
                                              wintypes.DWORD, ctypes.POINTER(wintypes.DWORD))
    _security.ConvertSidToStringSidW.argtypes = (ctypes.c_void_p, ctypes.POINTER(wintypes.LPWSTR))
    _security.ConvertStringSecurityDescriptorToSecurityDescriptorW.argtypes = (
        wintypes.LPCWSTR, wintypes.DWORD, ctypes.POINTER(ctypes.c_void_p), ctypes.c_void_p)
    _security.GetSecurityInfo.argtypes = (wintypes.HANDLE, ctypes.c_int, wintypes.DWORD,
                                         ctypes.POINTER(ctypes.c_void_p), ctypes.c_void_p,
                                         ctypes.POINTER(ctypes.c_void_p), ctypes.c_void_p,
                                         ctypes.POINTER(ctypes.c_void_p))
    _security.GetSecurityInfo.restype = wintypes.DWORD
    _security.GetSecurityDescriptorControl.argtypes = (ctypes.c_void_p, ctypes.POINTER(wintypes.WORD),
                                                       ctypes.POINTER(wintypes.DWORD))
    _security.GetAce.argtypes = (ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(ctypes.c_void_p))
    _native.NtSetInformationFile.argtypes = (wintypes.HANDLE, ctypes.c_void_p, ctypes.c_void_p,
                                            wintypes.DWORD, ctypes.c_int)
    _native.NtSetInformationFile.restype = ctypes.c_long
    _native.NtCreateFile.argtypes = (ctypes.POINTER(wintypes.HANDLE), wintypes.DWORD, ctypes.c_void_p,
                                    ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD,
                                    wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD)
    _native.NtCreateFile.restype = ctypes.c_long
    _native.NtQueryDirectoryFile.argtypes = (wintypes.HANDLE, wintypes.HANDLE, ctypes.c_void_p,
        ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.c_int,
        ctypes.c_byte, ctypes.c_void_p, ctypes.c_byte)
    _native.NtQueryDirectoryFile.restype = ctypes.c_long
    _native.RtlNtStatusToDosError.argtypes = (ctypes.c_long,)
    _native.RtlNtStatusToDosError.restype = wintypes.DWORD

    class _Attributes(ctypes.Structure):
        _fields_ = [('attributes', wintypes.DWORD), ('tag', wintypes.DWORD)]

    class _SecurityAttributes(ctypes.Structure):
        _fields_ = [('length', wintypes.DWORD), ('descriptor', ctypes.c_void_p), ('inherit', wintypes.BOOL)]

    class _Acl(ctypes.Structure):
        _fields_ = [('revision', ctypes.c_byte), ('reserved', ctypes.c_byte), ('size', wintypes.WORD),
                   ('count', wintypes.WORD), ('reserved2', wintypes.WORD)]

    class _Rename(ctypes.Structure):
        _fields_ = [('replace', ctypes.c_byte), ('parent', wintypes.HANDLE),
                   ('length', wintypes.DWORD), ('name', wintypes.WCHAR * 1)]

    class _IoStatus(ctypes.Structure):
        _fields_ = [('status', ctypes.c_void_p), ('information', ctypes.c_size_t)]

    class _UnicodeString(ctypes.Structure):
        _fields_ = [('length', wintypes.WORD), ('maximum', wintypes.WORD), ('buffer', wintypes.LPWSTR)]

    class _ObjectAttributes(ctypes.Structure):
        _fields_ = [('length', wintypes.DWORD), ('root', wintypes.HANDLE),
                   ('name', ctypes.POINTER(_UnicodeString)), ('attributes', wintypes.DWORD),
                   ('security', ctypes.c_void_p), ('quality', ctypes.c_void_p)]

    def _sid_string(sid):
        value = wintypes.LPWSTR()
        if not _security.ConvertSidToStringSidW(sid, ctypes.byref(value)):
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            return value.value
        finally:
            _kernel.LocalFree(value)

    def _current_sid():
        token = wintypes.HANDLE()
        if not _security.OpenProcessToken(_kernel.GetCurrentProcess(), 8, ctypes.byref(token)):
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            required = wintypes.DWORD()
            _security.GetTokenInformation(token, 1, None, 0, ctypes.byref(required))
            buffer = ctypes.create_string_buffer(required.value)
            if not _security.GetTokenInformation(token, 1, buffer, required, ctypes.byref(required)):
                raise ctypes.WinError(ctypes.get_last_error())
            sid = ctypes.cast(buffer, ctypes.POINTER(ctypes.c_void_p))[0]
            return _sid_string(sid)
        finally:
            _kernel.CloseHandle(token)

    @contextlib.contextmanager
    def _owner_attributes():
        sid = _current_sid()
        descriptor = ctypes.c_void_p()
        sddl = f'O:{sid}D:P(A;;FA;;;SY)(A;;FA;;;{sid})'
        if not _security.ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl, 1, ctypes.byref(descriptor), None):
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            attributes = _SecurityAttributes(ctypes.sizeof(_SecurityAttributes), descriptor, False)
            yield ctypes.byref(attributes)
        finally:
            _kernel.LocalFree(descriptor)

    def _win_open(path, *, directory=False, create=False, secret=False, delete=False, parent=None, on_created=None):
        access = 0x20081 if directory else (0x40000080 if create else 0x80000000)
        if directory is None:
            access = 0x20080
        if delete:
            access = 0x10080
        flags = 0x00200000 | (0x02000000 if directory else 0)
        with _owner_attributes() if secret and create else contextlib.nullcontext(None) as attributes:
            if parent is None:
                handle = _kernel.CreateFileW(str(path), access, 3 if directory or not create else 0,
                                             attributes, 1 if create else 3, flags, None)
            else:
                text = ctypes.create_unicode_buffer(Path(path).name)
                length = len(Path(path).name.encode('utf-16-le'))
                name = _UnicodeString(length, length + 2, ctypes.cast(text, wintypes.LPWSTR))
                descriptor = ctypes.cast(attributes, ctypes.POINTER(_SecurityAttributes)).contents.descriptor if attributes else None
                object_attributes = _ObjectAttributes(ctypes.sizeof(_ObjectAttributes), parent,
                    ctypes.pointer(name), 0x40, descriptor, None)
                handle_value = wintypes.HANDLE()
                result = _native.NtCreateFile(ctypes.byref(handle_value), access | 0x100000,
                    ctypes.byref(object_attributes), ctypes.byref(_IoStatus()), None, 0x80,
                    3 if directory or not create else 0, 2 if create else 1,
                    0x200020 | (1 if directory else (0 if directory is None else 0x40)), None, 0)
                if result < 0:
                    code = _native.RtlNtStatusToDosError(result)
                    if code in (2, 3):
                        raise FileNotFoundError(code, 'Filesystem path does not exist', str(path))
                    if code in (80, 183):
                        raise FileExistsError(code, 'Exclusive filesystem creation refused', str(path))
                    raise ctypes.WinError(code)
                handle = handle_value.value
        if handle == ctypes.c_void_p(-1).value:
            code = ctypes.get_last_error()
            if code in (2, 3):
                raise FileNotFoundError(code, 'Filesystem path does not exist', str(path))
            if code in (80, 183):
                raise FileExistsError(code, 'Exclusive filesystem creation refused', str(path))
            raise ctypes.WinError(code)
        try:
            if create and on_created is not None:
                on_created()
            attributes = _Attributes()
            if not _kernel.GetFileInformationByHandleEx(handle, 9, ctypes.byref(attributes), ctypes.sizeof(attributes)):
                raise ctypes.WinError(ctypes.get_last_error())
            if attributes.attributes & 0x400:
                raise UnsafePathError('Filesystem redirect refused')
            if directory is not None and bool(attributes.attributes & 0x10) != directory:
                raise UnsafePathError('Filesystem path has the wrong file type')
            return handle
        except BaseException:
            _kernel.CloseHandle(handle)
            raise

    def _win_delete(path, parent):
        handle = _win_open(path, delete=True, parent=parent)
        try:
            disposition = ctypes.c_byte(1)
            result = _native.NtSetInformationFile(handle, ctypes.byref(_IoStatus()),
                ctypes.byref(disposition), ctypes.sizeof(disposition), 13)
            if result < 0:
                raise ctypes.WinError(_native.RtlNtStatusToDosError(result))
        finally:
            _kernel.CloseHandle(handle)

    def _win_listdir(handle):
        names, restart = [], True
        while True:
            buffer, status = ctypes.create_string_buffer(32768), _IoStatus()
            result = _native.NtQueryDirectoryFile(handle, None, None, None,
                ctypes.byref(status), buffer, len(buffer), 12, False, None, restart)
            restart = False
            if result & 0xFFFFFFFF == 0x80000006:
                return names
            if result < 0:
                raise ctypes.WinError(_native.RtlNtStatusToDosError(result))
            offset = 0
            while offset < status.information:
                next_offset = ctypes.c_uint32.from_buffer(buffer, offset).value
                length = ctypes.c_uint32.from_buffer(buffer, offset + 8).value
                name = ctypes.string_at(ctypes.addressof(buffer) + offset + 12, length).decode('utf-16-le')
                if name not in ('.', '..'):
                    names.append(name)
                if not next_offset:
                    break
                offset += next_offset
    def _win_rename(source, target_name, parent):
        # Use the already-held destination directory rather than MoveFileEx,
        # which tries to reopen that directory while its sharing is locked.
        handle = _win_open(source, delete=True, parent=parent)
        try:
            encoded = target_name.encode('utf-16-le')
            buffer = ctypes.create_string_buffer(_Rename.name.offset + len(encoded))
            record = ctypes.cast(buffer, ctypes.POINTER(_Rename)).contents
            record.replace, record.parent, record.length = 1, parent, len(encoded)
            ctypes.memmove(ctypes.addressof(buffer) + _Rename.name.offset, encoded, len(encoded))
            result = _native.NtSetInformationFile(handle, ctypes.byref(_IoStatus()), buffer, len(buffer), 10)
            if result < 0:
                raise ctypes.WinError(_native.RtlNtStatusToDosError(result))
        finally:
            _kernel.CloseHandle(handle)

    def _win_validate_secret(handle):
        owner, acl, descriptor = ctypes.c_void_p(), ctypes.c_void_p(), ctypes.c_void_p()
        result = _security.GetSecurityInfo(handle, 1, 5, ctypes.byref(owner), None,
                                          ctypes.byref(acl), None, ctypes.byref(descriptor))
        if result:
            raise ctypes.WinError(result)
        try:
            sid = _current_sid()
            control, revision = wintypes.WORD(), wintypes.DWORD()
            if (_sid_string(owner) != sid or not acl.value
                    or not _security.GetSecurityDescriptorControl(descriptor, ctypes.byref(control), ctypes.byref(revision))
                    or not control.value & 0x1000):
                raise UnsafePathError('Secret requires an owner-only protected Windows DACL')
            owner_access = False
            for index in range(ctypes.cast(acl, ctypes.POINTER(_Acl)).contents.count):
                ace = ctypes.c_void_p()
                if not _security.GetAce(acl, index, ctypes.byref(ace)):
                    raise ctypes.WinError(ctypes.get_last_error())
                header = ctypes.string_at(ace, 4)
                if header[0] != 0:
                    raise UnsafePathError('Secret DACL contains an unsupported access entry')
                trustee = _sid_string(ctypes.c_void_p(ace.value + 8))
                if trustee not in (sid, 'S-1-5-18'):
                    raise UnsafePathError('Secret DACL grants access to another principal')
                mask = ctypes.c_uint32.from_address(ace.value + 4).value
                owner_access |= trustee == sid and mask & 0x1F01FF == 0x1F01FF
            if not owner_access:
                raise UnsafePathError('Secret DACL does not grant its owner full access')
        finally:
            _kernel.LocalFree(descriptor)


class SecureRoot:
    """Hold every traversed directory until exit; refuse links before access.

    Windows directory handles omit delete sharing, preventing parent renames;
    native relative opens refuse reparse points without retraversing paths.
    POSIX operations use O_NOFOLLOW and dir_fd so
    replacing a pathname cannot redirect subsequent operations into a link.
    """

    def __init__(self, root):
        self.root = Path(root).absolute()
        self._directories = {}
        self._ancestors = []

    def __enter__(self):
        try:
            if '..' in self.root.parts:
                raise UnsafePathError('Filesystem root contains parent traversal')
            _parts('/'.join(self.root.parts[1:]))
            anchor = Path(self.root.anchor)
            if os.name == 'nt':
                handle = _win_open(anchor, directory=True)
            else:
                handle = os.open(anchor, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            self._ancestors.append(handle)
            current = anchor
            for component in self.root.parts[1:]:
                current /= component
                if os.name == 'nt':
                    handle = _win_open(current, directory=True, parent=handle)
                else:
                    handle = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=handle)
                self._ancestors.append(handle)
            self._directories[()] = handle
            return self
        except BaseException:
            self.close()
            raise

    def __exit__(self, *_):
        self.close()

    def close(self):
        handles = list(self._directories.values()) + self._ancestors
        for handle in reversed(list(dict.fromkeys(handles))):
            _kernel.CloseHandle(handle) if os.name == 'nt' else os.close(handle)
        self._directories.clear()
        self._ancestors.clear()

    def _directory(self, parts, *, create=False, private=False):
        for count in range(1, len(parts) + 1):
            prefix = parts[:count]
            if prefix in self._directories:
                if private:
                    self._validate_secret(self._directories[prefix], directory=True)
                continue
            parent = self._directories[prefix[:-1]]
            path = self.root.joinpath(*prefix)
            if os.name == 'nt':
                if create:
                    try:
                        handle = _win_open(path, directory=True, create=True, secret=private, parent=parent)
                    except FileExistsError:
                        handle = _win_open(path, directory=True, parent=parent)
                else:
                    handle = _win_open(path, directory=True, parent=parent)
            else:
                if create:
                    try:
                        os.mkdir(prefix[-1], 0o700 if private else 0o755, dir_fd=parent)
                    except FileExistsError:
                        pass
                handle = os.open(prefix[-1], os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            self._directories[prefix] = handle
            if private:
                self._validate_secret(handle, directory=True)
        handle = self._directories[parts]
        if private:
            self._validate_secret(handle, directory=True)
        return handle

    @staticmethod
    def _validate_secret(handle, *, directory=False):
        if os.name == 'nt':
            _win_validate_secret(handle)
        else:
            info = os.fstat(handle)
            expected = 0o700 if directory else 0o600
            if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != expected:
                raise UnsafePathError(f'Secret requires owner-only {expected:o} permissions')

    def inspect(self, relative='.', *, must_exist=False):
        parts = _parts(relative)
        if not parts:
            handle = self._directories[()]
            if os.name != 'nt':
                return os.fstat(handle)
            duplicate = wintypes.HANDLE()
            process = _kernel.GetCurrentProcess()
            if not _kernel.DuplicateHandle(process, handle, process, ctypes.byref(duplicate), 0, False, 2):
                raise ctypes.WinError(ctypes.get_last_error())
            try:
                descriptor = msvcrt.open_osfhandle(duplicate.value, os.O_RDONLY | os.O_BINARY)
            except BaseException:
                _kernel.CloseHandle(duplicate)
                raise
            try:
                return os.fstat(descriptor)
            finally:
                os.close(descriptor)
        try:
            parent = self._directory(parts[:-1])
            path = self.root.joinpath(*parts)
            if os.name == 'nt':
                handle = _win_open(path, directory=None, parent=parent)
                descriptor = msvcrt.open_osfhandle(handle, os.O_RDONLY | os.O_BINARY)
                try:
                    info = os.fstat(descriptor)
                finally:
                    os.close(descriptor)
            else:
                info = os.stat(parts[-1], dir_fd=parent, follow_symlinks=False)
            if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
                raise UnsafePathError('Filesystem redirect refused')
            if not (stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode)):
                raise UnsafePathError('Filesystem special file refused')
            if stat.S_ISDIR(info.st_mode):
                self._directory(parts)
            return info
        except FileNotFoundError:
            if must_exist:
                raise
            return None

    def preflight_write(self, relative):
        parts = _parts(relative)
        if not parts:
            raise UnsafePathError('A file destination is required')
        # Missing parents are allowed, but every existing component is held.
        for count in range(1, len(parts)):
            if self.inspect('/'.join(parts[:count])) is None:
                return
        info = self.inspect(relative)
        if info is not None and not stat.S_ISREG(info.st_mode):
            raise UnsafePathError('A file destination is required')

    @contextlib.contextmanager
    def open_read(self, relative, *, max_bytes=None, secret=False):
        """Yield a no-follow regular-file stream whose handle owns its identity."""
        parts = _parts(relative)
        if not parts:
            raise UnsafePathError('A file source is required')
        parent = self._directory(parts[:-1])
        if secret:
            self._validate_secret(parent, directory=True)
        path = self.root.joinpath(*parts)
        if os.name == 'nt':
            handle = _win_open(path, parent=parent)
            try:
                if secret:
                    self._validate_secret(handle)
                descriptor = msvcrt.open_osfhandle(handle, os.O_RDONLY | os.O_BINARY)
            except BaseException:
                _kernel.CloseHandle(handle)
                raise
        else:
            descriptor = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
            try:
                if secret:
                    self._validate_secret(descriptor)
            except BaseException:
                os.close(descriptor)
                raise
        with os.fdopen(descriptor, 'rb') as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode):
                raise UnsafePathError('Filesystem source is not a regular file')
            if max_bytes is not None and info.st_size > max_bytes:
                raise UnsafePathError('Filesystem source exceeds its byte budget')
            yield stream

    def read_bytes(self, relative, *, max_bytes=None, secret=False):
        with self.open_read(relative, max_bytes=max_bytes, secret=secret) as stream:
            payload = stream.read() if max_bytes is None else stream.read(max_bytes + 1)
            if max_bytes is not None and len(payload) > max_bytes:
                raise UnsafePathError('Filesystem source exceeds its byte budget')
            return payload

    def files(self, relative='.'):
        for child, info in self.iterdir(relative):
            if stat.S_ISDIR(info.st_mode):
                yield from self.files(child)
            else:
                yield child, info

    def iterdir(self, relative='.'):
        """Enumerate one held directory and inspect each child without redirects."""
        parts = _parts(relative)
        handle = self._directory(parts)
        names = _win_listdir(handle) if os.name == 'nt' else os.listdir(handle)
        for name in sorted(names):
            child = '/'.join((*parts, name))
            info = self.inspect(child, must_exist=True)
            yield child, info

    def mkdir_private(self, relative):
        self._directory(_parts(relative), create=True, private=True)

    def _create_bytes(self, parts, payload, *, secret=False, on_created=None):
        parent = self._directory(parts[:-1], create=True, private=secret)
        if secret:
            self._validate_secret(parent, directory=True)
        if os.name == 'nt':
            handle = _win_open(self.root.joinpath(*parts), create=True, secret=secret, parent=parent, on_created=on_created)
            try:
                if secret:
                    self._validate_secret(handle)
                descriptor = msvcrt.open_osfhandle(handle, os.O_WRONLY | os.O_BINARY)
            except BaseException:
                _kernel.CloseHandle(handle)
                raise
        else:
            descriptor = os.open(parts[-1], os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                                 0o600, dir_fd=parent)
            try:
                if on_created is not None:
                    on_created()
                if secret:
                    self._validate_secret(descriptor)
            except BaseException:
                os.close(descriptor)
                raise
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())

    def create_secret(self, relative, payload):
        parts = _parts(relative)
        if not parts:
            raise UnsafePathError('A secret file destination is required')
        self._create_bytes(parts, payload, secret=True)

    def write_bytes_atomic(self, relative, payload):
        parts = _parts(relative)
        self.preflight_write(relative)
        parent = self._directory(parts[:-1], create=True)
        temporary = (*parts[:-1], f'.{parts[-1]}.{secrets.token_hex(12)}.tmp')
        owned = False
        def mark_owned():
            nonlocal owned
            owned = True
        try:
            self._create_bytes(temporary, payload, on_created=mark_owned)
            if os.name == 'nt':
                _win_rename(self.root.joinpath(*temporary), parts[-1], parent)
            else:
                os.replace(temporary[-1], parts[-1], src_dir_fd=parent, dst_dir_fd=parent)
        finally:
            if owned:
                self.remove_file('/'.join(temporary))

    def remove_file(self, relative):
        parts = _parts(relative)
        if not parts:
            raise UnsafePathError('A file deletion target is required')
        parent = self._directory(parts[:-1])
        info = self.inspect(relative)
        if info is None:
            return
        if not stat.S_ISREG(info.st_mode):
            raise UnsafePathError('A regular file deletion target is required')
        try:
            if os.name == 'nt':
                _win_delete(self.root.joinpath(*parts), parent)
            else:
                os.unlink(parts[-1], dir_fd=parent)
        except FileNotFoundError:
            pass


def safe_read_bytes(root, relative, max_bytes=None):
    """Read one bounded regular file without following filesystem redirects."""
    with SecureRoot(root) as secured:
        return secured.read_bytes(relative, max_bytes=max_bytes)


def secure_secret_read(path):
    """Read a protected owner-only private key; never relax existing permissions."""
    path = Path(path).absolute()
    with SecureRoot(path.parent) as secured:
        return secured.read_bytes(path.name, max_bytes=64 * 1024, secret=True)


def secure_private_directory(path):
    """Create missing key directories securely and validate existing ones."""
    path = Path(path).absolute()
    ancestor = path.parent
    while not ancestor.exists():
        if ancestor == ancestor.parent:
            raise UnsafePathError('Private directory has no existing ancestor')
        ancestor = ancestor.parent
    with SecureRoot(ancestor) as secured:
        secured.mkdir_private(path.relative_to(ancestor).as_posix())


def create_secret_file(path, payload):
    """Exclusively create one protected file in its validated private directory."""
    path = Path(path).absolute()
    with SecureRoot(path.parent) as secured:
        secured.create_secret(path.name, payload)
