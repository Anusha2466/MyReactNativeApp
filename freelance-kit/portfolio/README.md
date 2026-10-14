# Freelance kit: part-time Android & React Native

Self-contained. Nothing here touches the rest of the repo.

## 1. Portfolio (`portfolio/index.html`)

A single static page. No build step and no dependencies.

1. Open `portfolio/index.html` and edit only the `PROFILE` block at the top of the `<script>`.
   Fill in every `TODO`: rate, email, LinkedIn, GitHub, and your real projects.
2. Double-click the file to preview it in a browser.
3. To get a public link, use any free static host:
   - **GitHub Pages:** push the `portfolio/` folder to a repo, then Settings → Pages.
   - **Netlify Drop:** drag the `portfolio/` folder onto https://app.netlify.com/drop.

Put the link in your LinkedIn headline, Upwork profile, and every application.

## 2. Job finder (`job-finder/`)

Runs **only when you trigger it**. No background jobs, no schedules, no installs (needs Node 18+).

```bash
cd freelance-kit/job-finder
npm run jobs        # part-time / contract / freelance Android & RN posts, opens a report
npm run jobs:all    # every Android / RN match, part-time ones flagged
npm run jobs:new    # only posts you haven't seen on a previous run
```

- **Searches:** Remotive, Remote OK, Jobicy, We Work Remotely, and the monthly Hacker News
  "Who is hiring?" and "Seeking freelancer?" threads.
- **Also includes:** one-click searches for boards without a free API (LinkedIn part-time/contract,
  Upwork hourly, Naukri, Indeed India, Freelancer, Wellfound, Reddit r/forhire).
- **Output:** `job-finder/output/jobs-<date>.html`. Seen posts are tracked in `job-finder/.seen.json`.
  Both are git-ignored, and you can delete them anytime.
- **Tuning:** edit `job-finder/config.json` to change skills, part-time keywords, title exclusions,
  and the maximum post age.
