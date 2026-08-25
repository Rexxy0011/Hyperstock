# Assets

Static files imported by the client. Vite fingerprints and inlines/copies these at build time, so
**import them** rather than referencing `/public` paths — a renamed or missing file then fails the build
instead of 404-ing in production.

**Import from `assets.js`, never from a file path.** That module is the only place an image path
appears, so recompressing or renaming a file is one line there rather than a hunt through the tree.

```jsx
import { assets, investorPhoto } from '../assets/assets';

<img src={assets.logoMark} alt="" />
<Avatar src={investorPhoto(username)} name={name} />
```

## Layout

```
assets/
  assets.js    the single import surface — everything below is reached through it
  brand/       logo marks, wordmarks, favicons — anything identity
  images/      photography, illustrations, screenshots
  investors/   square 160px leaderboard portraits, named by username
```

## brand/

| File | Use |
|---|---|
| `logo-mark.png` | 512×512, transparent outside the disc. Everything renders this. |
| `logo-source.jpeg` | The original supplied screenshot. Kept for provenance; not imported. |

`logo-mark.png` was derived from `logo-source.jpeg`, which arrived as a screenshot with the disc sitting on
a blurred grey backdrop. The disc was located by scanning for pixels below luminance 28 (the artwork reads
0, the backdrop never drops below 33), cropped square at the measured 543px diameter, inset 1.5% to trim
JPEG ringing at the rim, then masked with a 4× supersampled circle for a clean antialiased edge.

**If a vector export ever turns up, prefer it** — the nav renders at 28px and a marketing header may want
120px+, and 512px raster will soften when scaled up. Swapping is a one-line import change in
`components/ui/Logo.jsx`; nothing else references the file.

Note the artwork carries "HYPER STOCKS" *inside* the disc. At nav size that text is ~5px tall and
unreadable, which is why small placements still render a separate text label (`withWordmark`), while large
ones (the auth screen at 72px) drop it.

Favicons in `client/public/` (`favicon.png` 48×48, `apple-touch-icon.png` 180×180) are downscaled from the
same source; regenerate them if the logo changes.

## images/

| File | Use |
|---|---|
| `hero-chart.webp` | 1036×858, transparent. The Landing hero visual, imported by `pages/Landing.jsx`. |
| `hero-chart-source.png` | The supplied background-removed render. Kept for provenance; not imported. |

Raster assets. Export at 2× the largest rendered size for high-DPI displays, and prefer `.webp` over
`.png`/`.jpg` unless transparency or lossless output is required.

`hero-chart.webp` is `cwebp -q 85 -alpha_q 100` of the source — 787 kB to 48 kB, which matters because it
is the largest thing on the first paint of the marketing page. The hero column is ~600px at the
`max-w-300` breakpoint, so 1036px wide covers 2× without upscaling.

**The shipped webp has its white point lifted**, which the source does not. The render's brightest tone
was 231–237, never white, so the card came out *darker* than the `bg-mist` field (247) it floats on —
backwards, and it read as a grey slab rather than a card. A levels pull of `255/234` puts the card on 251.
It is proportional rather than a flat fill of the panel region: a flat fill leaves a grey rim on the
rounded corners where the edge is anti-aliased, and dark text only moves ~9% (30 → 33), which is invisible.

**Keep the inner panel.** It was stripped once and put back: that panel is the artwork's *card*, and the
AAPL and FB cards read as floating only because they overlap it. Removing it also strands their drop
shadows as grey smudges, since those shadows are painted onto the panel rather than composited over
transparency. The Landing hero instead sets the card off by putting a `bg-mist` field behind it — see the
comment on `Hero` in `pages/Landing.jsx`.

The source arrived at 1163×912 with 28px of fully transparent margin on the left and 99px on the right;
it is cropped to the alpha channel's bounding box so the artwork fills its layout box instead of sitting
off-centre inside invisible padding. **It carries its own alpha, so it must render without a border,
card shadow or radius** — those would draw a frame around the transparent margin rather than the artwork.
