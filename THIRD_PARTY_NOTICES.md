
The pilot mascot (`lib/captain/**`, `components/gist/pilot/Bot.tsx`) is adapted from MIT-licensed work:

## bloub

The animation engine in `lib/engine.ts` (silhouettes, gaze math, expressions,
animation poses and the frame sampler) and parts of the studio UI, export pipeline
and copy (`lib/dicts.ts`, `lib/cycles.ts`, `lib/exporter.ts`, `components/`) are
adapted from **bloub** by Jérémy Perret: https://github.com/jeremy-prt/bloub

Changes in this project include the 3D captain hat with spring physics, the face
(eyes with pupils, mouth, blush), the default pose, the effect palette, the Bob and
Ahoy animations, the React port and the `CaptainMascot` component.

bloub is distributed under the following license:

```
MIT License

Copyright (c) 2026 Jérémy Perret

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
```
