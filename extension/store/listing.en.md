# Chrome Web Store listing (English)

> The store shows one listing language unless the manifest is localised (`default_locale` + `_locales/`), and this build is not: the title and summary come from the Traditional Chinese `manifest.json`. This file is the English text for the day a locale is added, or for a reviewer who asks what the extension does. Nothing here is uploaded for the first submission.
>
> **This is the 0.1.0 submission text**: it includes AI check (called Check now until 2026-10-27), the account background and the block helper (decided 2026-10-25); on 2026-10-26 it became chips only (no folding) with a three-number popup and no feature switches.

## Name (≤ 75 characters)

Whospost Reply Signals

## Summary (≤ 132 characters; 127 here)

On Threads post pages, accounts Whospost has checked get chips by the name saying why; others can be checked live. No verdicts.

## Description

When you read the replies under a Threads post, some accounts make you wonder what they usually do. Whospost Reply Signals brings the results already published on the Whospost site next to the replies you are looking at; an account nobody has checked is checked only when you ask. It draws no conclusions: every signal links back to the original posts, so you can read them yourself.

On the page it does four things:

1. Reason chips. An account Whospost has checked and found something on gets the rules it matched right beside its name, such as "Repeated comments": light red for three or more of the six checks, light yellow for one or two (two at most beside the name, only the first when they do not fit; the rest are in the popover). An account checked with nothing found gets a light green "No concerns yet". Replies are never folded, dimmed or changed. "7 replies in this thread" marks what this thread alone shows. Click a chip: for accounts Whospost has an AI review of, you see a note written automatically by AI, naming the model that wrote it (an AI judgement, for reference only). The check counts and the date are on the "See full evidence" page.
2. AI check. Beside an account nobody has checked there is an "AI check" button. Only when you click is that one account name sent to Whospost; the name shows "Checking…" until the result is in, then the reason chips. Ten per hour at most; once they are used up the button becomes "Background", and pressing it then also brings back a result someone else already got for that account (free, not counted). Whoever checks an account, every user sees the result within about 20 minutes without checking again.
3. Block and report helper. The popover you open from a chip has two buttons, "Block this user" and "Report this user"; both work on that reply's own "⋯" menu, right on the post page you are reading, with no new tab. Blocking is your decision; Whospost only clicks for you and judges no one. One account per press, every block button greys out with a countdown for 8 seconds after a press, there is no "block all" and no built-in list. If any step of Threads' menu is not where it was, the helper stops there and says "Threads changed its layout, please press it yourself" — no guessing, no retry. Accounts you blocked this way are remembered on your computer only and are no longer marked. "Report" only opens Threads' own report window: you pick the reason and send it, Whospost picks and sends nothing.
4. The popup. How many accounts Whospost has analysed site-wide; your three running totals — AI checks, background lookups, blocks — kept on your computer only; how many AI checks and account-background reads are left this hour; and a donation button with links to the Whospost site, the source code and the privacy policy.

The six checks (one point each, six at most; the full rules and thresholds are in the SCORING document on the site):

- Repeated posts: half or more of the posts are the same or near-identical.
- Repeated comments: the same comment over and over, or 80% or more very short reactions.
- One author: replies under more than ten posts, with at least half of the comments going to a single author.
- One thread: more than ten comments under a single post.
- Mutual focus: this account and the one it replies to most each give the other more than half of their comments.
- Bursts: three or more comments within ten seconds under the same post.

Every check comes with the originals: "See full evidence" opens the Whospost result page, where each check lists the posts and comments it counted, linked back to Threads.

There is also "this thread": how many replies one account left in the thread you are reading, and how many accounts posted the same text. That looks only at the replies already loaded in front of you, is computed entirely in your browser, and sends nothing.

Account background (needs you signed in to Threads): authors with a chip get the flag of the place Threads lists beside their name (hover for the name) and how long ago they joined ("joined 3 years ago"; Threads gives the month only), and the chip's popover shows the joined month and the place. This is what Threads itself shows you in "About this profile" and on the name card; the extension reads it from Threads with your own session, keeps it on your computer for 7 days and never puts it into a score. For an account you press "AI check" on (its name already goes to Whospost for the check), the place and joined month read are sent along and published in the list, so other users see the flag and joined time without reading it themselves (the popover says "read by other users"). No other account's background is sent. An account that joined less than 60 days ago and replied a lot in this thread or is on the list has that note drawn darker, with "a new account is not a fake account" on hover. One account every 2 seconds at most, 300 an hour; turning the extension off stops it.

Replies read (from 0.2.0; needs you signed in to Threads): when you press "AI check", the extension also reads that account's latest 25 public replies (the first page of its Replies tab, as Threads shows it to anyone signed in) with your own session and sends them to Whospost for that one check, so the check is faster and cheaper to run. It reads that one account only, one page, only when you press; nothing is kept on your computer. A notice explains this before the first read, and the popup has a switch to turn it off.

What it does not do:

- It never says anyone is a troll or a bot. The score is an uncalibrated checklist, not a probability; fans, support accounts and friends can match some of the checks.
- It presses a Threads button for you only when you ask: "Block this user" clicks Threads' own "⋯ → Block → Block" on that reply; "Report this user" clicks only "⋯ → Report" and stops at Threads' report window. It never follows or likes, never sends a report, and never changes or hides a reply; it only adds chips beside names.
- It works without a Threads account; only the account background and the replies read need you signed in, and both read only from Threads itself.
- While you browse, no account name, URL or hash is sent to Whospost. The extension downloads a public list of hashed account names once an hour and matches locally.

Sent only when you act: "AI check" sends that one account name, and (from 0.2.0) that account's latest 25 public replies. Apart from that, one anonymous daily tally (pages seen, accounts compared, how many times you pressed AI check, background lookup and block, and how many replies reads were sent, refused or failed) goes out, carrying only the version and the date, with no account name or address; turning the extension off stops it. Details in the privacy policy.

Works on post pages of threads.com and threads.net. The interface is in Traditional Chinese for now.

Open source (Apache-2.0); the list data is CC BY-SA 4.0: https://github.com/Felix-Lai-12/whospost

## Category

Social & Communication

## URLs

- Homepage: https://whospost.felixlai.workers.dev/
- Support: https://whospost.felixlai.workers.dev/
- Privacy policy: https://whospost.felixlai.workers.dev/privacy
