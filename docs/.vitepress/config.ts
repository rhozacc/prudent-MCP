import { defineConfig } from "vitepress";
import { withMermaid } from "vitepress-plugin-mermaid";

export default withMermaid(defineConfig({
  title: "prudent-mcp",
  description: "Structured regulatory knowledge for IRB credit-risk model validation",
  base: "/prudent-mcp/",
  head: [
    ["link", { rel: "preconnect", href: "https://fonts.googleapis.com" }],
    ["link", { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" }],
    [
      "link",
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Besley:ital,wght@0,600;0,700;0,800;1,600&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&family=IBM+Plex+Mono:ital,wght@0,400;0,500;0,600;1,400&display=swap",
      },
    ],
  ],
  themeConfig: {
    nav: [
      { text: "Guide",    link: "/guide/" },
      { text: "Tools",    link: "/tools/" },
      { text: "Corpus",   link: "/corpus/" },
      { text: "Examples", link: "/examples/" },
      { text: "FAQ",      link: "/guide/faq" },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Introduction",  link: "/guide/" },
          { text: "Concepts",      link: "/guide/concepts" },
          { text: "Quickstart",    link: "/guide/quickstart" },
          { text: "Architecture",  link: "/guide/architecture" },
          { text: "Clients",       link: "/guide/clients" },
          { text: "FAQ",           link: "/guide/faq" },
        ],
      },
      {
        text: "Tools",
        items: [
          { text: "Overview",   link: "/tools/" },
          { text: "Meta",       link: "/tools/meta" },
          { text: "Regulation", link: "/tools/regulation" },
          { text: "Tests",      link: "/tools/tests" },
          { text: "Checks",     link: "/tools/checks" },
          { text: "Playbooks",  link: "/tools/playbooks" },
          { text: "Sources",    link: "/tools/sources" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Corpus structure", link: "/corpus/" },
          { text: "Schema reference", link: "/corpus/schemas" },
          { text: "Corpus graph",     link: "/corpus/graph" },
          { text: "Prompts",          link: "/prompts/" },
          { text: "Adapters",         link: "/adapters/" },
        ],
      },
      { text: "Examples", link: "/examples/" },
    ],
    socialLinks: [
      { icon: "github", link: "https://github.com/rhozacc/prudent-mcp" },
    ],
    search: { provider: "local" },
  },
}));
