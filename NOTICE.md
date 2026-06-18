# NOTICE — CebianX

## Upstream attribution

**CebianX is a modified version of [Cebian](https://github.com/maotoumao/Cebian).**

| Field        | Value                                                                  |
| :----------- | :--------------------------------------------------------------------- |
| Upstream     | <https://github.com/maotoumao/Cebian>                                  |
| Upstream author | [maotoumao](https://github.com/maotoumao)                            |
| Upstream license | GNU Affero General Public License v3.0 only (AGPL-3.0-only)        |
| This fork    | <https://github.com/zhixingt/Cebian>                                  |
| This fork maintainer | 肖泽林 ([@zhixingt](https://github.com/zhixingt))                |
| This fork license | GNU Affero General Public License v3.0 only (AGPL-3.0-only) — inherited from upstream, preserved unchanged |

Per the [AGPL-3.0 § 5(a)](./LICENSE) requirement, the work is prominently marked as modified (see the **"This is a modified fork"** notice at the top of [README.md](./README.md)).

## What CebianX is

CebianX is a rebrand + extension of upstream Cebian:

- **Brand:** `CebianX` (replaces the upstream "Cebian" brand in the user-facing product surface).
- **Visual identity:** Replaces the upstream C-letter icon with a blue/purple gradient **X** mark.
- **Product positioning:** Reframes the product as an "AI agent workspace" rather than just an "AI assistant".

The codebase, dependency graph, build pipeline, and underlying logic remain substantially identical to upstream.

## Modifications made in this fork

The following categories of changes have been made on top of upstream. For an exhaustive list, see `git log --first-parent main ^upstream/main` in this repository.

### Brand & presentation

- README.md / README.zh-CN.md — rewritten to use the `CebianX` brand, prominently mark the work as a modified fork, and preserve upstream attribution per the upstream's stated attribution request.
- NOTICE.md (this file) — added for AGPL-3.0 § 5(a) compliance.
- public/icon/{16,32,48,96,128}.png — to be replaced with the new CebianX brand mark.
- package.json `name` — updated to `CebianX` for npm-side consistency.
- wxt.config.ts `manifest.name` and `description` (via `__MSG_extName__` / `__MSG_extDescription__`) — pointed at the new brand via locales.
- locales/{en,zh_CN,zh_TW}.yml — `extName` and update-check description strings updated to the new brand.
- components/settings/sections/AboutSection.tsx — version label uses the new brand; upstream author's social handles are displayed as read-only text (no outbound links, no functional sharing UI) under a "关注作者" / "Follow the author" section to preserve author attribution per AGPL-3.0 § 5(c); a new "项目来源" / "Project source" block states the fork relationship, names the upstream author, names the new contributor to this fork, and restates the AGPL-3.0 license; upstream GitHub link retained as a fork-reference, augmented with a "fork of" label.
- site/ (Astro docs site) — page titles, navigation, and footer rebrand.

### Removed from upstream

The following upstream-specific content was removed during the rebrand because it is personal to the upstream author and not appropriate to carry into a downstream fork as outbound links / CTAs:

- The personal "My girlfriend" sponsor dedication in README.
- The WeChat-OA QR-code and Ko-fi donation **links** (and the `public/sponsor/` image assets backing them).

The upstream author's social handles on Chinese platforms (WeChat OA / Bilibili / Xiaohongshu) are **preserved** as read-only attribution text inside the in-extension About page (see "Brand & presentation" above). The X / Twitter handle has been removed — it is a personal social-media account, not an attribution notice required by AGPL-3.0 § 5(c). None of the preserved handles are rendered as clickable links, so the fork does not actively drive traffic to the upstream author's personal accounts, but the attribution is visible to the user. This satisfies the AGPL-3.0 § 5(c) obligation to preserve copyright/attribution notices while still observing fork hygiene.

Upstream **attribution** and the upstream **GitHub link** are preserved (see the "Upstream attribution" section above).

### Inherited unchanged

- `LICENSE` — the standard FSF-published AGPL-3.0 text is preserved verbatim, as required by the license itself.
- CLA.md / CLA.zh-CN.md — preserved for historical reference; the upstream CLA only governs contributions to the upstream repository, so it does not apply to contributions to this fork.
- CONTRIBUTING.md / CONTRIBUTING.zh-CN.md — preserved with a small fork-specific addendum guiding contributors to upstream for product-level changes.

## License obligations for downstream redistributors

If you redistribute CebianX (including by running it as a network service — the trigger condition that distinguishes AGPL-3.0 from GPL-3.0), you must:

1. **Preserve this NOTICE** (or equivalent) so that the upstream attribution and the modified-version notice remain prominent.
2. **Preserve the LICENSE** file unchanged.
3. **Preserve the upstream attribution link** to <https://github.com/maotoumao/Cebian>.
4. **Release the complete source of your modifications** under the same AGPL-3.0 license.
5. Not use the upstream's trademarks in a way that would mislead a reasonable person about the origin of the work. The `Cebian` name remains an identifier of the upstream project; `CebianX` is this fork's own identifier.

For commercial / closed-source use that cannot comply with AGPL-3.0, contact the upstream maintainer via GitHub.
