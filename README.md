## Plex to Letterboxd extension

Exports your Plex movie libraries to a CSV that Letterboxd can import. Films are read from the Plex API, so the export is complete and matched by IMDb/TMDB ID — no scrolling needed.

 1. Add the extension to your browser
 2. Open Plex Web and sign in — either your server directly (e.g. http://127.0.0.1:32400/web) or https://app.plex.tv
 3. Click the extension, pick the movie libraries to export and click **Export CSV**
 4. Import the file at https://letterboxd.com/import/ (diary) or into a list

Options:

- **Only watched films** — skip films you haven't played.
- **Include watched date and rating** — adds `WatchedDate` (last played) and `Rating10` (your Plex star rating) for importing watch history into your diary. Leave it off for list imports.

Films that are in several libraries are exported once. Watch status and ratings are those of the Plex user signed in to the tab.

[DEMO video (Youtube)](https://www.youtube.com/watch?v=umWKpgffUc0)

---

![extension](https://github.com/user-attachments/assets/34ae0f67-77b5-4810-8a22-773b95fdf317)
