# Privacy and data flow

## Local processing

The plugin reads the selected Markdown file from the current vault and follows full-note embeds and supported local image references. Leading YAML frontmatter is removed from notes. The export may include text from embedded notes, so review the content before sending. No whole-vault upload is performed.

The EPUB is generated in memory. Export writes the EPUB to the configured folder inside the vault; your existing vault synchronization may subsequently copy it elsewhere. Sending does not save an EPUB to disk through the export command.

## Network activity

- **Test connection:** contacts your configured SMTP host and authenticates with your configured username and secret. Does not send a note.
- **Send:** after confirmation, contacts the configured SMTP host and submits an email containing the note title and EPUB attachment. The EPUB includes its author, expanded note text and packaged local images. The mail provider processes the message and routes it to Amazon's Send to Kindle service.
- **Export:** no network use by the plugin.

The plugin enforces TLS with certificate verification. Port 465 uses implicit TLS; port 587 requires STARTTLS. SMTP authentication does not support OAuth in this release.

Remote image URLs are not fetched. No Amazon internal API, Amazon account login, developer backend, advertising, telemetry, or analytics is used by the plugin. Amazon and your email provider handle their own delivery records and policies.

## Credentials and configuration

The plugin stores non-secret configuration, including email addresses, SMTP host, username, author and export-folder name, in Obsidian's plugin `data.json`. It stores only the selected secret's ID in that file. The password itself is retrieved from Obsidian SecretStorage, which is managed by Obsidian. Other installed plugins may access named secrets using Obsidian APIs; this is not an isolation boundary between plugins.

Image files are packaged as original bytes after basic signature checks. Their embedded metadata, including potential location or camera details, is not removed. Only include material you intend to share with your mail provider and Amazon.

## Removal

Disable or uninstall the plugin to stop its activity. Remove its saved secret through Obsidian's Keychain settings if no other plugin needs it. Revoke the app password with your email provider to invalidate it server-side. Local EPUB exports remain until you delete them. Previously sent documents must be removed separately from Amazon and your email account as needed.

## Public bug reports

Share the plugin version, operating system, provider name and a sanitized error code. Do not upload `data.json`, vault files, app passwords, SecretStorage contents or unredacted settings screenshots.
