# Setup — endpoint, schema and token

One-time, per person, per environment. Do this in the Craft control panel; none of
it can be done through the API.

## 1. Confirm the endpoint

```
https://YOUR-SITE.com/actions/graphql/api
```

Check it is reachable at all:

```bash
curl -s -X POST https://YOUR-SITE.com/actions/graphql/api \
  -H 'Content-Type: application/json' -d '{"query":"{ping}"}'
```

A `404` means the endpoint is disabled or mapped to a custom route — check
`config/routes.php`, or ask the agency that built the site.

## 2. Create a private schema

**GraphQL → Schemas → New schema.** Grant, deliberately narrowly:

- **View** on the sections you want readable.
- **Edit** on only the sections you want draftable. Craft has no "drafts only"
  scope, so edit permission is what makes the draft mutations appear.
- Nothing else. Leave assets, categories, tags, globals and users unticked —
  `guard.mjs` blocks them anyway, so granting them buys nothing.

This matters: the token is the real boundary. The guard is the second line of
defence, not the first. If the schema cannot see users, no bug in this tool can
touch users.

## 3. Create a token

**GraphQL → Tokens → New token**, bound to that schema. Copy the 32-character
value — it is shown once. Regenerating it revokes the old one.

Tokens are per-environment. Point this at staging first if the site has one.

## 4. Configure this machine

Either export the variables in your shell profile:

```bash
export CRAFT_GRAPHQL_ENDPOINT="https://YOUR-SITE.com/actions/graphql/api"
export CRAFT_GRAPHQL_TOKEN="..."
```

or write them to `~/.config/craft-cms/env`, which the script reads as a fallback:

```bash
mkdir -p ~/.config/craft-cms
cat > ~/.config/craft-cms/env <<'CONF'
CRAFT_GRAPHQL_ENDPOINT=https://YOUR-SITE.com/actions/graphql/api
CRAFT_GRAPHQL_TOKEN=your-token-here
CONF
chmod 600 ~/.config/craft-cms/env
```

The token never enters the conversation, a repo, or a prompt — only the
environment. Set `CRAFT_CONFIG` to use a different path.

## 5. Verify

```bash
node <skill-dir>/scripts/craft.mjs query --q '{ ping }'
node <skill-dir>/scripts/craft.mjs sections
node <skill-dir>/scripts/craft.mjs mutations   # read this output carefully
```

`craft mutations` prints what the token *could* mutate and what this tool blocks.
If something on the blocked list alarms you, tighten the schema in step 2 — that
removes the capability rather than merely refusing it.

## 6. Check the guard is live

```bash
node <skill-dir>/scripts/craft.mjs query --q 'mutation { deleteEntry(id: 1) }'
# BLOCKED: this document contains a `mutation` operation...  (exit 2)
```

Run the test suite after changing anything in `scripts/`:

```bash
node --test <skill-dir>/scripts/test/
```
