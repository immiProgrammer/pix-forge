# AI rename

Use **AI rename** beside the Rename button in the file toolbar.

1. Choose All images or Selected images. Images excluded from batch renaming are omitted.
2. Choose Folder name or Custom / current names. The custom product name is optional; leave it empty to clean up each existing name independently.
3. Add optional instructions, then copy the prompt into an AI tool of your choice. Files are a compact list of source paths with no repeated name/folder metadata. The default asks for Unicode-safe, lowercase, hyphen-separated names while preserving product colors, sizes, and variants and removing capture noise and unrelated timestamps. Extra instructions can request different formatting.
4. Open Import mapping and paste the JSON response. Review the changes, then apply them. One application is one naming-history entry, so Undo and Redo work for the whole batch.

Example response (values are filename stems, without extensions):

```json
{
  "catalog/shoes/WhatsApp-red-size-42.png": "running-shoes-red-size-42",
  "catalog/shoes/Screenshot-blue-size-40.jpg": "running-shoes-blue-size-40"
}
```

Keys use original source filenames, including their original extensions, relative folders, and imported root names. Current export root aliases are used when configured. Paths must match the prompt exactly. JSON order does not matter; changes are reviewed in the workspace's display order. Omitted paths remain unchanged. The importer rejects unknown/out-of-scope paths, duplicate keys, non-string values, invalid or empty names, and case-insensitive output conflicts with other images in the session. It does not automatically slugify the AI response, so explicit formatting instructions are preserved.

Only filenames and folder names are included in the prompt. PixForge does not connect to an AI service or send images. Copying the prompt is a user action; original files are unchanged. Output extensions still follow the processing settings.
