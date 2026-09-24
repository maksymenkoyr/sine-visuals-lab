# Third-party notices

This project bundles the following third-party packages and data into its client build.

## CMU Graphics Lab Motion Capture Database (the dance clips in `src/render/scenes/dancers/clips.bin`)

- The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217.
- License: the database's terms of use — the motion capture data "may be copied, modified, or redistributed without permission" and may be included in commercially-sold products; it may not be resold directly, even in converted form.
- Source: http://mocap.cs.cmu.edu — BVH conversion by Bruce Hahne (cgspeed), https://sites.google.com/a/cgspeed.com/cgspeed/motion-capture, mirrored at https://github.com/una-dinosauria/cmu-mocap. The trials used, and how they are cut, are listed in `tools/clip-cuts.json`; `tools/clip-convert.mjs` does the conversion.

## Chakra Petch (via `@fontsource/chakra-petch`)

- Copyright 2018 The Chakra Petch Project Authors (https://github.com/m4rc1e/Chakra-Petch.git)
- License: SIL Open Font License, Version 1.1 (text below)
- Source: https://github.com/m4rc1e/Chakra-Petch — packaged by Fontsource, https://github.com/fontsource/fontsource

## Share Tech Mono (via `@fontsource/share-tech-mono`)

- Copyright (c) 2012, Carrois Type Design, Ralph du Carrois (www.carrois.com post@carrois.com), with Reserved Font Name 'Share'
- License: SIL Open Font License, Version 1.1 (text below)
- Source: packaged by Fontsource, https://github.com/fontsource/fontsource

## Shippori Mincho B1 (via `@fontsource/shippori-mincho-b1`)

- Copyright 2021 The Shippori Mincho Project Authors (https://github.com/fontdasu/ShipporiMincho)
- License: SIL Open Font License, Version 1.1 (text below)
- Source: https://github.com/fontdasu/ShipporiMincho — packaged by Fontsource, https://github.com/fontsource/fontsource

## DSEG7-Classic (via `dseg`)

- Copyright (c) 2017, keshikan (http://www.keshikan.net), with Reserved Font Name "DSEG"
- License: SIL Open Font License, Version 1.1 (text below)
- Source: https://github.com/keshikan/DSEG

### SIL Open Font License, Version 1.1

The fonts above are each licensed under this same text; each font's own
copyright statement and Reserved Font Name appear in its entry.

```
-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

## Vite

- Used: the `modulepreload` polyfill Vite's build injects into the client
  bundle so browsers without native `modulepreload` support still preload a
  page's module graph. Not a dependency we import — emitted automatically by
  `vite build` (see the `target:` comment in vite.config.ts for why the
  polyfill stays on rather than being disabled).
- Source: https://github.com/vitejs/vite
- License: MIT (text below)
- Copyright © 2019-present, VoidZero Inc. and Vite contributors

MIT License

Copyright (c) 2019-present, VoidZero Inc. and Vite contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## qrcode-generator

- Author: Kazuhiko Arase
- License: MIT
- Source: https://github.com/kazuhikoarase/qrcode-generator

MIT License

Copyright (c) Kazuhiko Arase

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

## Inigo Quilez's distance-field and shading snippets

- Used: a handful of signed-distance-field primitives and small shading
  helpers published on iquilezles.org — a capsule ray intersector, an
  ellipsoid bound, a rounded box, a segment (capsule) distance, polynomial
  smooth min/max, a hexagon distance field and its prism extrusion, a
  tetrahedral-tap normal, and a branchless HSV-to-RGB conversion.
- Files: `src/render/scenes/dancers/fastRenderers.ts` (the capsule ray
  intersector), `src/render/scenes/dancers/sdf.ts` (the ellipsoid, rounded
  box, segment, and smooth min/max), `src/render/scenes/dancers/rig.ts` (the
  along-axis capsule distance), `src/render/scenes/dancers/index.ts` (the
  tetrahedral normal), `src/render/scenes/crystal/glsl.ts` (the rounded box,
  hexagon, hex-prism extrusion and capsule distance), `src/render/scenes/petri.ts`
  (the HSV-to-RGB conversion). Each site carries its own credit comment.
- Source: https://iquilezles.org/articles/ (distance functions, intersectors,
  smooth minimum, and the normals/palette articles)
- License: MIT (text below)
- Copyright © Inigo Quilez

MIT License

Copyright © Inigo Quilez

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

## Dave Hoskins's "Hash without Sine"

- Used: the float hashes `hash12` and `hash11` — a fract-of-a-large-product
  hash that avoids the precision problems `sin()`-based hashes hit on some
  GPU drivers.
- Files: `src/render/scenes/storm.ts` (`hash12`), `src/render/scenes/slats/glsl.ts`
  (`hash11`)
- Source: https://www.shadertoy.com/view/4djSRW
- License: MIT (text below)
- Copyright © 2014 David Hoskins

MIT License

Copyright © 2014 David Hoskins

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
