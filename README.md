# Host (Tinyhost-style static hosting UI)

This project is a frontend for uploading and publishing static websites with Supabase Storage.

## Features

1. **Clean adjustable UI themes**: Bluish, Dark, and White
2. **User auth + dashboard** with Supabase Auth
3. **Static site deployment** (ZIP/files/folder upload)
4. **Plan-aware limits** and project cards

## Backend setup (required)

On first load, click **Setup backend** and add:

1. **Supabase URL** (`https://<project-ref>.supabase.co`)
2. **Supabase anon key** (public API key from Supabase dashboard)

The app stores this config in browser localStorage (`vaultex.backendConfig`).

## Supabase requirements

Create these tables (minimum):

1. `profiles` with `id` (uuid, same as auth user id) and `plan` (text)
2. `projects` with `user_id`, `name`, `slug`, `url`, `file_label`

Optional extended columns already supported:

1. `hosting_url`
2. `storage_prefix`
3. `entry_path`

Also create a Storage bucket named **`sites`** and add RLS policies that allow authenticated users to manage objects under their own prefix (`<user_id>/<slug>/...`).

## Deploy this website

Because this is a static app (`index.html`, `style.css`, `script.js`), you can deploy it directly using:

1. **GitHub Pages** (already compatible with `CNAME` / `.nojekyll`)
2. **Netlify**
3. **Vercel static deployment**