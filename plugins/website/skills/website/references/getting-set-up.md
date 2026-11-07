# Getting set up

For the person setting up, in plain steps. When a setup check fails, read them the step
that fixes it, in your own words, one step at a time. The skill's README carries the
same steps.

## What you need

- The **Claude desktop app**, signed in, with **Cowork**.
- The **address of your website** (for example `example.com`), and a way to **sign in to
  its editor**: your Squarespace, WordPress, Shopify or Craft login.

## 1. Let Claude run code (required)

Open **Settings → Capabilities** and turn on **Code execution and file creation**.
Skills only run with it on, and the skill's tools need it.

✓ The switch is on.

**Can't turn it on?** On a Team or Enterprise plan only an Owner can. Ask whoever
manages Claude for your organization to turn it on for you. There is no way around this
one: without it the skill can't run at all.

## 2. Let Claude reach your website (recommended)

On the same Capabilities page, allow network access for your website's address, for
example `example.com`.

✓ Your site's address is in the list of allowed sites.

**Can't allow it?** On a Team or Enterprise plan only an Owner can, under
**Organization settings → Capabilities → Code execution**: turn on network access and
add the site's address. If that isn't possible, carry on. Claude reads your site through
the browser instead: everything still works, but the first session is slower.

## 3. Install the skill

Use the first way that works for you.

**A. From GitHub (best, because it updates itself).**

1. Open **Customize** in the sidebar, then **Plugins**.
2. Choose **Add marketplace** (it may be under **Add**), and enter
   `khevamann/brand-skills`.
3. Find **website** in the list and click **Install**.
4. Turn on **Sync automatically** for the brand-skills marketplace.

✓ **website** shows as installed under **Customize → Plugins**.

**B. From the zip, if you can't add a marketplace.**

1. Download `website-skill.zip` from the latest release at
   `github.com/khevamann/brand-skills/releases/latest`, under **Assets** (not "Source
   code (zip)", which Claude rejects).
2. Open **Customize → Skills**, click **+**, then **Create skill → Upload a skill**, and
   choose the zip without unzipping it.

✓ **website** is in your list of skills, with its switch on.

**C. Through your organization, if neither A nor B shows up.** This is common on a
managed Team or Enterprise account. Ask an Owner to either:

- turn on **User-created skills** under **Organization settings → Plugins & skills →
  Policy**, so you can use A or B; or
- upload `website-skill.zip` for the organization themselves, under **Organization
  settings → Plugins & skills**, and make it available to you.

## 4. Make a folder for the site

Make a new, **empty** folder on your computer for this one website, for example
`Documents/Websites/Acme website`. Everything Claude learns about the site is kept here.
If you look after several sites, make one folder for each.

✓ The folder exists and is empty.

## 5. Make a Cowork project for the site

In **Cowork**, create a new project (for example "Acme Website") and **attach the folder**
from step 4. It needs no description or instructions.

✓ The project shows your folder. Use one project per site, always with that site's folder.

## 6. Have a browser ready

Claude works in your site's editor through a browser:

- If you use **Chrome**, install **Claude in Chrome**. Claude then uses the Chrome where
  you're already signed in to your site.
- Otherwise, Claude uses the **Claude app's built-in browser**. The first time it opens
  a site, the app asks you to allow it. Allow your site, and its editor's address when
  asked (on Squarespace that is a separate `….squarespace.com` address).

## 7. Start

In the Cowork project, **start a new chat** and type:

> Set up the website skill for example.com

(or `/website setup example.com`). Then follow Claude:

1. **It checks everything first** and tells you if something above needs fixing.
2. **It confirms the folder and the site**, and asks what your site is built on if it
   can't tell.
3. **It asks you to sign in** to your site's editor in the browser. You sign in
   yourself; Claude never sees or stores your password.
4. **It captures your whole site** while you watch: every page, a check for problems on
   phones, tablets and desktops, how your editor works, and your colours, fonts and
   building blocks. Nothing on your site is changed.
5. **It finishes with one fix to try**, something it noticed on your site, as a test
   that everything works, and a few ideas for later.

## Afterwards

- **Always start new chats inside that same Cowork project.** That's how Claude
  remembers your site. Just say what you'd like to do.
- **When there's a new version of the skill**, it arrives by itself if you used A and
  **Sync automatically** is on (or choose **Check for updates** on the marketplace). With
  B, delete the old **website** skill in **Customize → Skills** and upload the new zip.
  With C, ask the Owner to replace it. Then, in your site's project, say "**Update the website skill**".
  Claude brings your folder up to date and finishes anything new.
- **To send feedback**, say "**Send feedback on the website skill**" (or
  `/website feedback`). Claude bundles what it has learned
  about your site and your conversations into one file for you to send to the skill
  author. You can open it to check first.

## If something goes wrong

| What you see | What to do |
|---|---|
| Claude says this isn't a Cowork project, or there's no folder | Do steps 4 and 5, then start a new chat in that project |
| Claude can't reach your site | Do step 2, or let Claude carry on through the browser |
| Claude has no browser | Do step 6 |
| No **Add marketplace** option | Use B in step 3 |
| You can't upload the skill either | Step 1 is probably off, or your organization hasn't allowed it: use C in step 3 |
| Code execution can't be turned on | Only an Owner can turn it on (step 1); the skill can't run without it |
| Claude doesn't seem to know the skill | Check step 3, then say "Set up the website skill" |
