# Repository Rules & Agent Manifesto

## Chrome Browser & Markdown Policy
- **No Chrome Browser for Markdown Exports**: In this repository, agents must **NOT** launch the Chrome browser or invoke `browser_subagent` to browse pages, convert pages to markdown, or generate browser scratchpad `.md` files.
- **Lightweight Tooling Requirements**:
  - Use `read_url_content` for fetching web content directly without browser overhead.
  - Use Node.js scripts, `curl`, or HTTP requests for API/endpoint verification.
  - Use direct source file inspection (`view_file`, `grep_search`) and build verification (`npm.cmd run build:frontend`) for validation.
  - Keep all agent workflows lightweight, fast, and avoid heavy browser session recordings unless explicitly commanded by the user.

## Code & Engineering Principles
- **Design System Fidelity**: Maintain Aladenflow Studio aesthetic standards (harmonious dark glassmorphism, semantic CSS variables, crisp vector SVGs).
- **Windows Execution**: Use `npm.cmd` for Node/Angular builds and package operations in the Windows environment.
