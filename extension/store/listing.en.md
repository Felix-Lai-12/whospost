# Chrome Web Store listing (English)

> The store shows one listing language unless the manifest is localised (`default_locale` + `_locales/`), and this build is not: the title and summary come from the Traditional Chinese `manifest.json`. This file is the English text for the day a locale is added, or for a reviewer who asks what the extension does. Nothing here is uploaded for the first submission.
>
> **This text includes the 0.2 "account background" paragraph; the 0.1.0 submission does not have that feature.**

## Name (≤ 75 characters)

Whospost Reply Signals

## Summary (≤ 132 characters; 128 here)

On Threads post pages, replies with several public behaviour signals fold into one row; a chip by the name shows why. No verdicts.

## Description

When you read the replies under a Threads post, some accounts make you wonder what they usually do. Whospost Reply Signals brings the results already published on the Whospost site next to the replies you are looking at; an account nobody has checked is checked only when you ask. It draws no conclusions: every signal links back to the original posts, so you can read them yourself.

On the page it does three things:

1. Folds. A reply from an account Whospost has checked that matches three or more of the six checks is folded into one row, "N replies folded · reasons", like Instagram's "View more replies". "Show" opens the row; "Trust all" lets the whole group through.
2. Chips. Other replies with something to show get a small chip beside the name, such as "1 of 6 checks" or "7 replies in this thread". Click the chip for the reasons, the numbers and the date of the check.
3. Live check. Beside an account nobody has checked, hovering the name reveals "Check now". Only when you click is that one account name sent to Whospost; a quick pass comes back first, then the full result. Ten per hour at most.

The six checks (one point each, six at most; the full rules and thresholds are in the SCORING document on the site):

- Repeated posts: half or more of the posts are the same or near-identical.
- Repeated comments: the same comment over and over, or 80% or more very short reactions.
- One author: replies under more than ten posts, with at least half of the comments going to a single author.
- One thread: more than ten comments under a single post.
- Mutual focus: this account and the one it replies to most each give the other more than half of their comments.
- Bursts: three or more comments within ten seconds under the same post.

Every check comes with the originals: "See full evidence" opens the Whospost result page, where each check lists the posts and comments it counted, linked back to Threads.

There is also "this thread": how many replies one account left in the thread you are reading, and how many accounts posted the same text. That looks only at the replies already loaded in front of you, is computed entirely in your browser, and sends nothing.

Account background (needs you signed in to Threads): authors with a chip get one more line, such as "joined 2026-09 · Taiwan · 1,234 followers", and the chip's popover shows it in full. This is what Threads itself shows you in "About this profile" and on the name card; the extension reads it from Threads with your own session, keeps it on your computer for 7 days, never sends it to Whospost and never puts it into a score. An account that joined less than 60 days ago and replied a lot in this thread or is on the list gets a grey "new account" mark; a new account is not a fake account. One request every 2 seconds at most, 60 an hour; it can be switched off in the popup, which also clears what was kept.

What it does not do:

- It never says anyone is a troll or a bot. The score is an uncalibrated checklist, not a probability; fans, support accounts and friends can match some of the checks.
- It never presses a Threads button for you (no follow, like, report or block) and never changes the text of a reply; it only folds or dims, and you can always open it.
- It works without a Threads account; only the account background needs you signed in, and it reads only from Threads itself.
- While you browse, no account name, URL or hash is sent to Whospost. The extension downloads a public list of hashed account names once an hour and matches locally.

Sent only when you act: "Check now" sends that one account name; "Trust" sends a hash of the account name (counted as an appeal; it never changes a score). "Contribute counts" sends one anonymous daily tally by default (pages seen, accounts compared, replies folded), carrying only the version and the date; it can be switched off in the popup. Details in the privacy policy.

Election mode: from 18 to 28 November 2026 the extension automatically shows chips only, without folding or dimming; the popup can change that back.

Works on post pages of threads.com and threads.net. The interface is in Traditional Chinese for now.

Open source (Apache-2.0); the list data is CC BY-SA 4.0: https://github.com/Felix-Lai-12/whospost

## Category

Social & Communication

## URLs

- Homepage: https://whospost.felixlai.workers.dev/
- Support: https://whospost.felixlai.workers.dev/
- Privacy policy: https://whospost.felixlai.workers.dev/privacy
