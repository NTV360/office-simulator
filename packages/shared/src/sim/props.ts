/** The five things a person can hold or carry. The simulation sets these; the client shows or hides the matching meshes. */
export const PROP_KEYS = ['mug', 'phone', 'pad', 'guitar', 'putter'] as const;
export type PropKey = (typeof PROP_KEYS)[number];
export type HeldProps = Record<PropKey, boolean>;

export const newProps = (): HeldProps => ({ mug: false, phone: false, pad: false, guitar: false, putter: false });
