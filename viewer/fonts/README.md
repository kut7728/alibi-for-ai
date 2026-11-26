# IBM Plex

Unmodified WOFF2 files from IBM’s official [Plex packages](https://github.com/IBM/plex#packages).

- `@ibm/plex-sans@2.0.0`: Regular and SemiBold
- `@ibm/plex-sans-condensed@3.0.0`: Bold
- `@ibm/plex-mono@2.5.0`: Regular, SemiBold, and Bold

The packages above supply the Latin1 files. The CJK packages below supply Regular and
SemiBold from `fonts/split/woff2/hinted/`:

- [`@ibm/plex-sans-kr@1.1.0`](https://www.npmjs.com/package/@ibm/plex-sans-kr/v/1.1.0) supplies all 11,172 modern Hangul syllables and the upstream Hangul jamo coverage.
- [`@ibm/plex-sans-jp@3.0.0`](https://www.npmjs.com/package/@ibm/plex-sans-jp/v/3.0.0) supplies subsets 060–123 with CJK glyphs, plus the subsets needed for remaining upstream kana and viewer copy. Each weight exposes 7,641 kanji, including 2,457 of the 2,965 JIS X 0208 level-1 kanji. Other kanji use system fallback.

The ranges in [fonts.css](../fonts.css) retain the CJK mappings present in both the
upstream CSS and each subset's character map. The files share IBM's copyright and
the [SIL Open Font License 1.1](OFL.txt).
