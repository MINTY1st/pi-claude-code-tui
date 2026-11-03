# Third-party notices

## earendil-works/pi-claude-code

This project is a fork of [earendil-works/pi-claude-code](https://github.com/earendil-works/pi-claude-code) by Armin Ronacher. It retains upstream provider integration, conversation conversion, and local relay code. The original copyright notice and full MIT license are preserved in [LICENSE](LICENSE).

## yetone/magpie

The interactive Claude Code PTY design was informed by [yetone/magpie](https://github.com/yetone/magpie) by yetone, including terminal-query responses, prompt settling, input handling, and readiness detection. The inspected reference revision was [`a3768cdd1113118998863ed36bd6dd77c8e9e2cc`](https://github.com/yetone/magpie/tree/a3768cdd1113118998863ed36bd6dd77c8e9e2cc).

This package does not bundle the magpie application or use its JSONL/tap response collection. It implements a TypeScript/Python PTY adapter around the upstream Pi relay. The reference project's copyright and complete MIT notice are reproduced below to retain attribution for the referenced interaction techniques and any adapted portions.

```text
MIT License

Copyright (c) 2026 yetone

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
