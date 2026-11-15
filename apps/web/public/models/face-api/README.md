# Local face recognition models

Copied from the `model/` directory of `@vladmandic/face-api` version 1.7.15.
Upstream: https://github.com/vladmandic/face-api
The accompanying MIT license is retained in LICENSE.txt.

Only Tiny Face Detector, 68-point landmarks and the 128-dimensional face recognition model are used. These files are served by this application; no CDN or external image inference service is used.

The original hand-built image descriptors and their old threshold must not be mixed with this model's descriptors. A distance cutoff of 0.5 plus an ambiguity margin of 0.05 is used as a conservative starting point, with two consecutive live matches. These settings require validation with real members and the installed camera before production use.
