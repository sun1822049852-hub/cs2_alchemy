const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const agentsPath = path.join(__dirname, "..", "AGENTS.md");
const skillPath = path.join(__dirname, "..", "skills", "ui-runtime-guardrails", "SKILL.md");

const agents = fs.readFileSync(agentsPath, "utf8");
const skillExists = fs.existsSync(skillPath);
const skill = skillExists ? fs.readFileSync(skillPath, "utf8") : "";

assert.equal(
  skillExists,
  true,
  "repo should include a ui-runtime-guardrails skill for frontend runtime validation work"
);

assert.match(
  agents,
  /skills\/ui-runtime-guardrails\/SKILL\.md/,
  "AGENTS should require the ui-runtime-guardrails skill for frontend tuning tasks"
);

assert.match(
  agents,
  /真实运行态验证|运行态证据|浏览器验证/,
  "AGENTS should emphasize runtime-verified UI work instead of source-only confidence"
);

assert.match(
  skill,
  /^---[\s\S]*name:\s*ui-runtime-guardrails/m,
  "the skill frontmatter should declare the ui-runtime-guardrails name"
);

assert.match(
  skill,
  /不要把源码测试当成运行态生效|源码测试.*运行态/,
  "the skill should explicitly forbid treating source-only tests as proof of visual success"
);

assert.match(
  skill,
  /Playwright|浏览器自动化|getBoundingClientRect|scrollHeight/,
  "the skill should call for runtime DOM evidence when visual fixes are disputed"
);

console.log("uiRuntimeGuardrailsSkill tests passed");
