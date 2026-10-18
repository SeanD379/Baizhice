# React Bits components used by New Chat

Official TypeScript + CSS sources copied from the local checkout of
[DavidHDev/react-bits](https://github.com/DavidHDev/react-bits), acquired on 2026-10-02.
The accompanying [LICENSE.md](./LICENSE.md) applies to these sources.

- [Prompt Bar](https://www.reactbits.dev/micro/prompt-bar): controlled draft and attachment names, removal by index, existing upload callback, disabled state, Chinese labels and input-method handling. The original resizing, press feedback and arrow morph are retained.
- [Thought Line](https://www.reactbits.dev/micro/thought-line): a header slot combines the Lattice Loader with the original trace and fold motion; failed steps remain visible and are not marked complete.
- [Lattice Loader](https://www.reactbits.dev/micro/lattice-loader?grid=4&glow=true&pattern=sweep): the original 4 by 4 sweep, glow and status marks, with a controlled shared clock and Chinese announcements.

The home layout follows the public preview of [Prompt Input 3](https://pro.reactbits.dev/docs/app-ui/prompt-input/prompt-input-3). No paid Pro block is installed.
# Practice results

The original-question material picker also uses the existing official [Spotlight Card](https://reactbits.dev/components/spotlight-card) source for compact, multi-select file cards. Its palette follows the app theme and retains subtle pointer/focus feedback while real checkboxes control the selected material IDs; preparation details remain collapsed until requested.

The results dashboard uses the official [Count Up](https://reactbits.dev/text-animations/count-up) TypeScript source from [DavidHDev/react-bits](https://github.com/DavidHDev/react-bits/blob/main/src/ts-default/TextAnimations/CountUp/CountUp.tsx), retrieved on 2026-10-13. It animates the saved round's reference score, accuracy, and mistake count once after hand-in. Restored results and reduced-motion preferences display final numbers directly. The short confetti celebration and dashboard entrance use local CSS.

# Annotation and draft cards

`SpotlightCard.tsx` and `SpotlightCard.css` use the official React Bits TypeScript/CSS source from [Spotlight Card](https://reactbits.dev/components/spotlight-card), retrieved on 2026-10-11. Material annotation and draft cards follow the app's light or dark theme with a subtle neutral spotlight, no proximity glow or press flare. Annotation card hover and keyboard focus also locate the corresponding document selection. Draft cards show readable content by default and open inputs only for explicit editing; review and notebook adoption remain separate actions.

# Learning analysis

The review priority panel reuses the existing official [Spotlight Card](https://www.reactbits.dev/components/spotlight-card) source. It follows the app theme with subtle pointer and keyboard focus feedback, without ambient animation, proximity glow or press flare. The cards show actual saved judgments and open their practice history section; the dashboard uses the read-only learning analysis endpoint rather than demonstration data.

