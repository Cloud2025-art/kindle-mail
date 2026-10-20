# Kindle Mail

Turn a note into a readable EPUB and send it to your Kindle through your own email account. Write and collect articles in Obsidian, then read them later on your Kindle.

**[Download 0.1.1](https://github.com/Cloud2025-art/kindle-mail/releases/tag/0.1.1)** · **[中文使用教程](docs/使用教程.md)** · [Privacy](PRIVACY.md) · [Release notes](CHANGELOG.md)

By James C. Free and open source under the MIT license. An independent community project, not affiliated with or endorsed by Amazon or Obsidian.

## Two commands, two purposes

| Command | Result | Sent to Kindle? |
| --- | --- | --- |
| 发送当前笔记到 Kindle — Send current note to Kindle | Builds an EPUB in memory, asks for confirmation, then emails it | Yes |
| 导出当前笔记为 EPUB — Export current note as EPUB | Saves an EPUB in your vault's `Kindle Exports` folder | No |

You do not need to export before sending. This first release has a Chinese interface; English translations of command and setting labels are provided below.

## Requirements

- Obsidian desktop 1.11.4 or later; mobile is not supported. Uses Node.js SMTP and Obsidian SecretStorage APIs.
- For sending: an Amazon account with a working Send to Kindle address, a Kindle device or app, and an email account that supports authenticated SMTP over TLS with a password or app password.
- An Internet connection for SMTP testing and sending. EPUB export works offline.
- OAuth-only email accounts are not supported. SMTP service availability and email-provider policies vary by account.

## Installation

The plugin is being prepared for community submission. Until accepted, install it manually:

1. Download `main.js` and `manifest.json` from the [0.1.1 release](https://github.com/Cloud2025-art/kindle-mail/releases/tag/0.1.1), or extract the `kindle-mail-0.1.1.zip` attachment.
2. In Obsidian, open **Settings → Community plugins** and click the folder icon next to **Installed plugins**. This opens the plugin folder for the actual vault you are using.
3. Create a `kindle-mail` folder there, and put both files directly inside it:

   ```text
   Your actual vault/
   └─ .obsidian/plugins/kindle-mail/
      ├─ main.js
      └─ manifest.json
   ```

4. Restart Obsidian, open **Settings → Community plugins → Installed plugins**, and enable **Kindle Mail**.

Do not search the online **Browse** catalog for an unpublished plugin. A common installation mistake is using a parent folder's `.obsidian` directory instead of the current vault's directory.

## Configure sending

Open **Settings → Kindle Mail**.

| Setting in the interface | Meaning | Gmail example |
| --- | --- | --- |
| SMTP 主机 | SMTP host | `smtp.gmail.com` |
| SMTP 用户名 | SMTP login | `your-account@gmail.com` |
| 发件邮箱 | Sender address | The same Gmail address |
| Kindle 收件邮箱 | Send to Kindle address | Your personal Kindle document address |
| SMTP 端口 | Encrypted SMTP port | `465 · TLS` or `587 · STARTTLS` |
| SMTP 授权码 | App password secret | Create/link a secret as described below |
| 电子书作者 | EPUB author | Your preferred name |
| EPUB 导出目录 | Export folder in this vault | `Kindle Exports` |

### Gmail app password

1. Enable **2-Step Verification** in your Google account, if it is not already enabled.
2. Open [Google App passwords](https://myaccount.google.com/apppasswords) and create an app password named `Obsidian Kindle`. This option may be unavailable for some managed or restricted accounts; see [Google's official instructions](https://support.google.com/mail/answer/185833).
3. In Kindle Mail, click **Link…** beside **SMTP 授权码**. Create a secret:
   - **ID:** `kindle-gmail` (an identifying label, not your email address).
   - **Secret:** the generated 16-character app password, with display spaces removed. Do not use your normal Google password or add an `sk-` prefix.
4. Save. If the setting still shows **Link…**, click it again and select `kindle-gmail`.
5. Click **测试连接** (Test connection). This checks SMTP connection and authentication only; it does not send email or verify Kindle delivery.

Use the same address for SMTP login and sender unless you have explicitly configured an authorized sending alias.

### Allow the sender in Amazon

In Amazon's **Manage Your Content and Devices → Preferences → Personal Document Settings**, add your sender address to the **Approved Personal Document E-mail List**. Also confirm your Kindle's personal document email address.

See [Amazon's official Send to Kindle email guidance](https://www.amazon.com/gp/sendtokindle/email). Amazon may require email confirmation for a delivery.

### Other providers

QQ and 163 presets are available. Enable SMTP with the provider and use its authorization code. For another provider, enter its documented host and TLS port. Hotmail/Outlook or organization accounts that require OAuth cannot authenticate with this version.

## Send a note

1. Open a Markdown note and let Obsidian save your edits.
2. Press **Ctrl+P** (Windows/Linux) or **Cmd+P** (macOS).
3. Run **Kindle Mail: 发送当前笔记到 Kindle**.
4. Review the note title, destination address, attachment size, image count, and any conversion warnings. Confirm **发送** (Send).
5. Wait for the SMTP acceptance message. Connect your Kindle to the Internet and allow Amazon time to process the document.

You can also right-click a Markdown file and choose **发送到 Kindle**. Assign a shortcut under **Settings → Hotkeys** if you send often.

SMTP acceptance is not a delivery receipt. If a send times out, check your Kindle and mailbox before retrying; the server may already have accepted the email.

## Export only

Run **Kindle Mail: 导出当前笔记为 EPUB** to keep a local copy or check formatting in an EPUB reader. Existing exports are not overwritten. No email account or network is required. This command does **not** send anything to Kindle.

## Conversion support

- Chinese and other UTF-8 text; standard Markdown headings, paragraphs, lists, quotes, tables, links and code.
- Leading YAML frontmatter is excluded.
- Full-note `![[embeds]]`, including relative local images. Maximum nesting: root plus two embedded note levels. Cycles, deeper embeds and section/block embeds show a visible omission marker.
- Local PNG, JPEG and GIF images, with basic signature checking. Original bytes are packaged, so source metadata and animation may remain; rendering depends on the reader.
- Wikilinks become display text. Raw HTML is escaped. Remote images are replaced with text and are never downloaded.
- Maximum local image: 10 MiB; total images: 20 MiB. Maximum EPUB sent: 25 MiB. Email services may impose lower limits after MIME encoding.
- Expansion is bounded to 100 note reads and 5 MiB of combined Markdown; image count is limited to 100.

Not converted: SVG, WebP, PDF, Canvas, Dataview, Mermaid and other plugin-rendered content. Checkboxes and `==highlight==` receive no special conversion. Callouts appear as ordinary blockquotes. Embedded notes use simplified block styling. Heading navigation is limited to a single document entry. This is a one-way send, not a live update or Kindle annotation sync.

## Privacy and network use

EPUB creation is local. No developer-operated server, analytics, advertising, payment or telemetry is used. When you test a connection, the plugin contacts your configured SMTP host and authenticates. When you confirm a send, the note title, author, expanded note text and packaged images are sent through your email provider to Amazon. Local exports can be synced by your vault sync provider.

Passwords are referenced through Obsidian SecretStorage; the plugin's `data.json` stores the secret name, not its value. Non-secret addresses and SMTP settings remain in `data.json`. SecretStorage is managed by Obsidian, and other plugins may access named secrets through that API. See [PRIVACY.md](PRIVACY.md) and [third-party notices](THIRD-PARTY-NOTICES.md).

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Plugin is missing | Open the actual vault's plugins folder from Obsidian; avoid an extra nested folder. Refresh or restart. |
| Link… remains beside the password | Create a secret, then select it for the SMTP setting. |
| Authentication fails | Use the matching SMTP username and provider app password; normal Gmail passwords do not work. |
| Connection times out | Verify network access and try the provider's other documented TLS port. |
| SMTP succeeds, Kindle gets nothing | Check the Kindle address, approved sender list, Amazon confirmation email, spam folder and device connection. |
| Images are missing | Only local PNG/JPEG/GIF are supported; remote images are deliberately omitted. |
| Export exists, Kindle is empty | Export saves locally. Use the Send command to deliver it. |

Never include passwords, secret-storage contents or personal notes in public bug reports.

## Development and validation

Use Node.js 22+ and pnpm 11:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
```

The output `main.js` is bundled with dependencies and requires no package installation by users. Release tags must equal the manifest version exactly, e.g. `0.1.1`, without `v`. Attach `main.js`, `manifest.json`, `LICENSE`, and `THIRD-PARTY-NOTICES.md` individually to the release. The Obsidian installer fetches the first two; bundled license comments are also retained in `main.js`.

The original 0.1.0 version was reported by the user to deliver successfully through Gmail to Kindle on Windows with Obsidian 1.14.4. Automated tests cover EPUB construction, escaping, embeds, image handling, resource bounds and email attachment construction. Version 0.1.1 includes hardening changes and needs an updated live send smoke test. Other desktop operating systems and email providers have not been verified.
