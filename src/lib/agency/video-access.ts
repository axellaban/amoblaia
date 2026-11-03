// Who may make videos in the panel: the same rules as editing a property
// (viewers only watch, the team's support view only reads).
import "server-only";
import { inScope, type Membership } from "./server";
import { canEdit as roleCanEdit } from "./shared";

export const inScopeOf = inScope;
export const canEdit = (m: Membership) => roleCanEdit(m.role) && !(m.support && !m.acting);
