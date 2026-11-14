"use client";

import { createContext } from "react";

/**
 * A way for a form to say "this worked" somewhere that outlives the form. When an item is
 * accepted its card moves to another list and the form (with its own "Accepted.") is thrown
 * away, so the confirmation is also sent here.
 */
export const NoticeContext = createContext<((message: string) => void) | null>(null);
