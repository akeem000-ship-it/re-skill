# Vendored: gerbiljames/mario-tennis-gbc-disasm

- Source: https://github.com/gerbiljames/mario-tennis-gbc-disasm
- Commit: 8e20e33 ("Build Mario Tennis (Europe) with make EUROPE=1")
- License: MIT, Copyright (c) 2026 James White (see LICENSE in this directory; it applies to everything here)

The repository's tracked files only. Its `data/` tree (graphics, audio, text and other binary data) is not here: it is
extracted from your own ROM by `./setup.sh path/to/rom.gbc`, as upstream intends. To build (needs RGBDS 1.0+):

    cd third_party/mario-tennis-gbc-disasm
    ./setup.sh ../../rom/mario_tennis.gbc
    make RGBDS=/path/to/rgbds/ compare        # mariotennis.gbc, build/mariotennis.sym

Used by this project as the reference for the match engine port (web/js/engine) — routine names, the RAM layout
and the subsystem write-ups in docs/. Kept as-is so it can be diffed against upstream; this project's own code
is meant to replace what it takes from here over time.
