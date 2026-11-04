# Third-Party Notices

This project includes or can interoperate with third-party components that retain their original licenses.

## PhysX JavaScript/WebIDL Bindings

- **Package:** `physx-js-webidl`
- **Location:** `engine/sim/physics/`
- **License:** MIT
- **Upstream:** https://github.com/fabmax/physx-js-webidl

The installed runtime is a locally compiled upgrade to NVIDIA PhysX 5.11.0,
source tag `ovphysx-0.6.3`, commit `da950a3537927784951853c66618036f332ca0ce`.
It includes Blast 5.0.6 core, generated Flow WGSL and MIT-licensed build-lab
Rust/binding bridges. Exact files and capabilities are recorded in
`engine/sim/physics/runtime-manifest.json`. The original package metadata is
retained for attribution; it does not identify the upgraded binary.

- **PhysX SDK:** Apache-2.0; `engine/sim/physics/notices/PhysX-sdk-LICENSE.md`.
- **NVIDIA repository / Flow:** retained license in `engine/sim/physics/notices/PhysX-LICENSE.md`.
- **Blast:** retained license in `engine/sim/physics/notices/blast-sdk-LICENSE.md`.
- **Bindings and build-lab bridges:** retained MIT texts in `engine/sim/physics/notices/`.

## Shader and Noise References

Some shader/noise implementation notes reference public-domain or MIT-licensed material. Public release packaging should preserve any source-level attribution present in the included files.

## Genuine handprint training data

- **EMNIST Balanced:** Gregory Cohen, Saeed Afshar, Jonathan Tapson, and Andre van Schaik (2017), *EMNIST: an extension of MNIST to handwritten letters*, https://arxiv.org/abs/1702.05373 . Derived from NIST Special Database 19. Official data: https://www.nist.gov/itl/products-and-services/emnist-dataset .
- Data are acquired from the NIST-hosted archive, with the original README retained in the developer data directory. NIST public-information and data terms apply: https://www.nist.gov/copyrights-disclaimers . Credit to NIST and the EMNIST authors is retained; this project is not endorsed by NIST.
- `tools/fetch-handprint-data.ps1` verifies the original archive and selected compressed IDX members. `tests/sewing/train-handprint-base.html` trains our existing AGI learner in browser JavaScript. The project-generated handprint model contains derived normalized pixel features and source-row provenance, not downloaded pretrained weights or an external OCR runtime.
- Transformation: upright transpose of the published IDX raster, original-pixel threshold/crop through Engine, shared 580-value glyph features, seeded balanced subset of the training prefix, and validation-only threshold selection. The final 18,800 training rows are reserved for validation; the test split is not used to fit or choose thresholds.
- The 47-class mapping merges some upper/lowercase letters. This is isolated handprinted-character data; test images do not establish general cursive recognition or verified writer-disjoint performance. Original dataset files remain developer inputs under `tmp/handwriting/`, not customer runtime downloads.

## Connected handwritten-word developer data

- **DHSD 1.0.0:** Nauman Riaz, Saifullah Saifullah, Stefan Agne, Andreas Dengel, and Sheraz Ahmed (2026), 5,939 genuine German handwritten geographic-name word images from 37 writers. Official release: https://zenodo.org/records/18743313 . Copyright remains with the authors; licensed under Creative Commons Attribution 4.0 International: https://creativecommons.org/licenses/by/4.0/ .
- Geographic names originate in OpenStreetMap. © OpenStreetMap contributors, available under the Open Database License: https://www.openstreetmap.org/copyright .
- `tools/fetch-connected-handwriting-data.ps1` verifies the original release archive and retains its original LICENSE, CITATION.cff, DATASHEET.md, source transcripts, writer IDs and per-image hashes. Original files remain developer data under `tmp/handwriting/dhsd/`; no external model weights or recognition code are copied.
- Project adaptations declare a separate deterministic split by whole writer IDs, a 256×32 white-paper image transform and ordered pixel-strip features. The authors' supplied train/test split overlaps writers and is not used to claim writer-disjoint performance. This narrow German-name corpus does not establish general English cursive recognition. The authors do not endorse this project.

## English handwriting photograph developer data

- **GNHK (2021):** Alex W. C. Lee, Jonathan Chung, and Marco Lee, *GNHK: A Dataset for English Handwriting in the Wild*, ICDAR 2021. Author repository and dataset terms: https://github.com/GoodNotes/GNHK-dataset . Copyright remains with the authors; the dataset is licensed under Creative Commons Attribution 4.0 International: https://creativecommons.org/licenses/by/4.0/ . The authors do not endorse this project.
- `tools/fetch-english-handwriting-data.ps1` retains the authors' complete license and README at commit `5be3842f4231d2b469198600c2b9b0a3745e4d34`. Because their original download page redirects to the current product home page, the archive is acquired from the public `staghado/GNHK-Dataset` mirror at commit `eaa67d396fd29b8b04e38d630da79f67db11b212`: https://huggingface.co/datasets/staghado/GNHK-Dataset . The 1,010,143,400-byte mirror archive has SHA-256 `5f4b470030b41cd80e32d3a5ae7bc8bc41acc79b4bf770a451e7ec54ca3be34d`. This verifies the mirrored bytes; an author-published checksum for the original archive was unavailable.
- Only source JPEG photographs and JSON annotations are extracted from the two contained data archives, with bounded paths, sizes, cardinality checks, and per-file hashes. The original 515 training and 172 test pages remain separate. Writer IDs are not supplied or inferred, so this document split is not described as writer-disjoint. Duplicate image hashes are recorded for exclusion or grouping before evaluation. The separately frozen DHSD writer benchmark remains unchanged.
- Original dataset files remain developer inputs under `tmp/handwriting/gnhk/`. Acquisition does not add recognition code, pretrained weights, an external OCR runtime, or a customer data download. Original bytes and transcripts are retained unchanged; derived crops, learning and evaluation must separately record their transforms and selected source identities.

## SOUL Sight lab reference teacher

- **Depth Anything V2 Small weights (lab only):** Apache-2.0 model by Lihe Yang, Bingyi Kang, Zilong Huang, Zhen Zhao, Xiaogang Xu, Jiashi Feng and Hengshuang Zhao. Source: `model.safetensors` from https://huggingface.co/depth-anything/Depth-Anything-V2-Small-hf at revision `5426e4f0f36572d16453bbda7a8389317b1bef99` (SHA-256 `3152477ce0d8d6978d76b995120de97cb5b928701fd0f817769f59e249a16b70`). Upstream: https://github.com/DepthAnything/Depth-Anything-V2 .
- Modification: `tools/convert_reference_depth_teacher.py` converted the weights to the project `agi.vision.checkpoint.v1` format (float16/float32), stored in `agi/vision/lab/reference-teacher/` together with the Apache-2.0 `LICENSE` and a `NOTICE`. No upstream code is included. The network is evaluated by project code (`agi/vision/lab/ReferenceDepthTeacher.js` on `agi/tensor`).
- Use: a developer benchmark and training-label source for the project-owned SOUL Sight model (`agi/vision/SoulSight.js`). Apps and demos never load it, and the converted `weights.bin` is not included in release bundles. SOUL Sight's architecture and shipped weights are project-authored.

## AVR microcontroller boards

- The megaAVR emulator in `engine/sim/avr/` is project code written from the Microchip ATmega328P/ATmega2560 datasheets and the AVR Instruction Set Manual; no third-party emulator is included.
- Arduino profile pin maps and body/header dimensions cite the official Arduino AVR core, published pinouts and CAD archives in `RealmForgeMicrocontrollerProfiles.js`. ATmega64A is an authored lab carrier using Microchip's published device facts, rather than a commercial Arduino board. Product names belong to their respective owners; no endorsement is implied.

## Optional Google Cast sender

- The standard Google Cast Web Sender SDK is loaded from Google's official endpoint only after the user chooses **Enable Google Cast**. Google supplies and licenses this runtime; it is not vendored or represented as project-authored code. SDK terms: https://developers.google.com/cast/docs/terms . The player uses Google's Default Media Receiver. No Luna receiver ID or custom Luna message protocol is included.

## Release Scope

The first public alpha is scoped to the engine SDK. Editor and Plauna artifacts are deferred unless a release target explicitly includes them.

## OpenAI mathematics release (Theory Lab catalogue data)

- **Source:** `overview.tex` of https://github.com/openai/math (October 2026 release), OpenAI, Apache License 2.0.
- **Location:** `engine/core/math/theory/catalog/TheoryFamilyData.js`, generated by `tools/build_theory_family_data.py`.
- **Use:** family numbers, titles, disciplines and result statements, converted from LaTeX to plain Unicode text. No proofs, Lean code or manuscripts are included; the engine's computations are independent implementations.
