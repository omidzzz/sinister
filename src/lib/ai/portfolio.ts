/**
 * Portfolio dossier — the factual grounding for the guest persona on the
 * public deployment. Injected after GUEST_SYSTEM_PROMPT so the assistant can
 * answer concrete questions about Omid's skills, services, site, and writing
 * without any tools or filesystem access. Keep it dense and factual; the
 * persona supplies the attitude.
 */
export const PORTFOLIO_KNOWLEDGE = `— PORTFOLIO DOSSIER (ground every site/owner question in these facts; never invent beyond it) —

WHO
Omid — frontend developer working since 2012. Background in translation
studies (professional EN<->FA translator), which he applies to build precise,
user-friendly websites. Works remotely with clients worldwide. Services:
(1) frontend development (React / JavaScript / TypeScript / Next.js),
(2) WordPress development, (3) content strategy, (4) professional
English<->Persian translation. Contact/pricing: use the site's contact links —
the assistant does not know rates or availability.

TOP-TIER SKILLS (the 4/4 arsenal)
Next.js (App Router, static generation), React, TypeScript, HTML5, REST APIs,
Web Performance & Core Web Vitals, TailwindCSS, CSS3/Sass, CSS design tokens,
advanced CSS animation & motion design, responsive layout (Grid/Flex).
AI-assisted software development, content creation and creative
problem-solving with LLMs are also 4/4.

SOLID SKILLS (3/4)
WebGL / GLSL shaders, Service Workers & PWA caching, i18n & RTL localization,
web accessibility, SEO & structured data (JSON-LD), WordPress + Elementor Pro
+ WooCommerce + Rank Math, MySQL / MariaDB / MongoDB, Lighthouse performance
auditing, image optimization (sharp, WebP/AVIF), Node.js build tooling,
ESLint + Prettier, Photoshop.
FAMILIAR (2/4 and below): Vue, Angular, Redux, Gatsby, Bootstrap, Bulma,
Material-UI, styled-components, PHP, Node.js backend, Firebase, Python, Rust,
Express, GraphQL, Vite, Illustrator, SVG code editing.

THE SITE ITSELF (this very portfolio)
Named SINISTEROID — a psychedelic "deep-space transmission deck" built as a
Next.js static export with an ACID RAVE design system: WebGL/GLSL shader
nebula background, acid-triad neon palette (cyan / magenta / UV violet / acid
lime), Orbitron display type, a vertical spine-rail navigation, command
palette (Ctrl+K or /), custom cursor reticle, scroll-bound prop floaters
(plant, frog, drone), a Konami-code easter egg, and a dark/light theme engine.
Fully bilingual EN/FA with proper RTL. Obsessively performance-tuned: CSS
inlined into <style>, images optimized, decorative shells lazy-mounted on
first interaction, Lighthouse-budgeted. Deploys as a fully static bundle.

THE BLOG (12 posts — cite by title when relevant)
- AI coding agents: "Claude Code vs Cline: Which AI Coding Agent Should
  Developers Use in 2026?", "Cline: The Open-Source AI Coding Agent
  Redefining Developer Workflows"
- Local AI: "Ollama: The Engine Behind Local AI", "Open WebUI: The Missing
  Interface for Local AI"
- SEO/GEO: "SEO vs GEO: What's the Difference?", "Zero-Click Search Is Here.
  Now What?", "Content Clusters for GEO: How to Build Topical Authority That
  AI Engines Trust"
- Content strategy: "From Clicks to Conversations: Why Your Content Strategy
  is Obsolete"
- Web architecture: "The Death of Traditional Websites: Designing for AI
  Agents"
- Privacy: "Your AI Tools Are Spying on You. Here's the Fix."
- Frontend/design: "Design Without Words Is Decoration", "Modern Techniques
  in Frontend Design"`;
