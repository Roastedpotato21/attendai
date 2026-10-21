# AttendAI public welcome page

The public page lives at `/welcome`. The existing protected dashboard `/`, sign-in,
signup, institution workflows and application pages retain their routes. Only the
new public-route registration touches the shared route/auth shell. No API,
database, migration, provider or delivery behavior changes in this pass.

## References and reuse

The three live references and their available implementations were inspected
before implementation. Graphics are native SVG; no screenshots of a template,
remote embeds or new animation dependencies ship with the page.

### Glyph Portal: the opening

[Glyph Portal by Christian Katzmann](https://21st.dev/@Legacy/components/glyph-portal)
is identified as MIT-licensed on its public component page. Its publicly served
[interactive demo](https://cdn.21st.dev/mailforreddit/glyph-portal/default/bundle.1788815860826-0c5bf3c3-bce9-42fc-87de-9c0a7a451187.html)
contains the implementation used for this adaptation. The registry endpoint
requires authentication; it was not bypassed.

`glyph-portal.tsx` retains the measured opaque-glyph interior, logarithmic zoom,
reciprocal camera interpolation, four-degree rotation, cubic easing and native
2.4-viewport scroll progression. The word is AttendAI. Letter selection supports
pointer and keyboard interaction. Canvas only measures glyphs once after font
loading; animation changes the SVG mask directly through scheduled animation
frames. Reduced motion presents a static word and removes the extended scroll.

MIT notice for the adapted Glyph Portal implementation:

Copyright (c) Christian Katzmann

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

### Fintech: background, visual system and footer

[Fintech SaaS reference](https://21st.dev/community/templates?preview=%2F%40kedhareswer%2Ftemplates%2Ffintech-saas-landing-page-template)
links to the author's [live workshop](https://21stdev-my-components-one.vercel.app/#maroon-fintech-landing).
The actual [public source folder](https://github.com/Kedhareswer/21stdev-my-components/tree/main/components/maroon-fintech-landing)
includes the component, README and custom demo. The repository's
[reuse permission](https://github.com/Kedhareswer/21stdev-my-components#readme)
states: "Free to view, copy, and adapt unless a folder says otherwise. Attribution
appreciated." This folder provides no additional restriction.

Credit: Kedhareswer Naidu. The circuit trace geometry, mirrored construction,
chip positions, normalized dash pulses and timing come from that component.
The dimensional device illustration is adapted from its SVG device. Financial
symbols and fabricated dashboard values are replaced with AttendAI branding and
abstract workflow labels. There are no example student identities or statistics.

The custom demo explicitly selects the source's **forest** palette: frame
`#2f4436`, paper `#e5e4da`, ink `#141a16`, brand `#2f5640`, night `#121d17`, card
`#1c2c22`, cream `#ecebe1`, device `#c9b79a` and glow `#ffd98a`. Muted body text
uses a darker value for readability. All tokens and CSS are scoped to the page.
The substantial column footer, oversized quiet wordmark and final colophon
follow the source's structure with real AttendAI links.

### Elena Voss: text motion only

The [Elena Voss reference](https://21st.dev/@hyperiux/templates/elena-voss-portfolio-template)
and [public live demo](https://elena-voss-portfolio-template-v3.21st.app/) were
inspected for rendered motion and typography. Its commercial source was not
obtained or copied. The AttendAI implementation independently uses masked line
entrances, a slight settling rotation, staggered lines, section wipes and
`cubic-bezier(0.22, 1, 0.36, 1)` easing. Native IntersectionObserver triggers
one-time reveals; neither portfolio layout nor hidden proprietary code is used.

## Fonts and motion cost

Inter Tight is the Fintech source's intended first font; Plus Jakarta Sans is
the Glyph demo's font. Page-specific family names keep the application's existing
typography intact. Local variable Latin WOFF2 files total **72,220 bytes** and
include their SIL Open Font License texts in `public/fonts`. Both fonts are
preloaded, use font-display swap and have reserved layout boxes. No remote font
dependency is introduced by the page.

The page adds no package dependencies. SVG wires pause outside the hero and when
the document is hidden. The portal field stops animating after entry. Glyph
measurement is cached, scroll handlers are passive and mask painting is limited
to one requested animation frame. There is no continuous JavaScript render loop.
Reduced motion disables zoom, animated traces, device float and text entrances.

## Navigation and content

Product, Solutions, Pricing, Docs, Security and About resolve to real page
sections. Sign In and Get Started use `/login` and `/create-account` respectively.
No Docs or Pricing route existed: inline guides and an explicit pricing-coming-
soon section provide honest destinations. Legal links use the existing `/privacy`
and `/terms`. No contact address, social account, customer logo, testimonial,
adoption number, commercial price or delivery result is invented.

## Local checks

Build before running the browser suite. With a local built preview and an isolated
headless Chrome debugging port:

    node scripts/test-welcome-browser.mjs http://127.0.0.1:4195 9339
    npm run test:auth-browser -- http://127.0.0.1:4195 9339
    npx tsc --noEmit
    npm run lint
    npm run build
    git diff --check

The welcome suite intercepts external browser requests. It checks server-rendered
public content, font loading, glyph zoom/letter selection, live and paused wires,
section reveals, anchors, native guide disclosure, keyboard controls, mobile menu,
reduced motion, entry routes and retained anonymous protected-route redirects.
It checks overflow at 320, 390, 768, 1024 and 1440 pixels. It reports observed local
headless layout shift and animation frame timing; these are not production
performance measurements or a guarantee of frame rate on every device.

Desktop/mobile screenshots were also inspected for the opening, intermediate
portal mask, hero, product cards and footer. No production writes, notification
sends or deployment are part of these checks.

Validation on the local production build passed TypeScript, lint, build, the
welcome browser suite and the existing auth browser suite. The welcome suite also
checks normal/large text against WCAG AA contrast thresholds. Its final warm
headless visit measured CLS **0.0029**, median frame interval **16.7 ms**, 95th
percentile **16.8 ms**, and zero observed long tasks. The route's compressed assets
are approximately **11 KB JavaScript + 7.2 KB CSS**, in addition to shared existing
application assets and the 72 KB local fonts. These measurements describe this
local run, not a production or low-end-device benchmark.
