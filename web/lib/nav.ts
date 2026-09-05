// The site's navigation, defined once.
//
// It used to live in the masthead menu and again in the footer, and /findings shipped into one and
// not the other, so on a phone (where the footer IS the navigation) it could only be reached by
// typing the address. Anything that needs a list of pages reads it from here.

export type NavLink = { href: string; label: string };

/** Reference pages: the ones someone goes looking for rather than lands on. */
export const REFERENCE: NavLink[] = [
  { href: "/about", label: "About Sloptic" },
  { href: "/methodology", label: "How grading works" },
  { href: "/checks", label: "Every check" },
  { href: "/findings", label: "The corpus study" },
  { href: "/verify", label: "Why only some checks run" },
];

/** Top level destinations, in masthead order. */
export const PRIMARY: NavLink[] = [
  { href: "/", label: "Grade an app" },
  { href: "/organizers", label: "For organizers" },
];

/** Only meaningful with an account. */
export const ACCOUNT: NavLink[] = [
  { href: "/account", label: "Account" },
  { href: "/events", label: "Your events" },
];

// /grades is deliberately absent. Signed in it redirects to /account, which renders the same list,
// so a nav entry would be a second door into one room. Signed out it is still reachable, from the
// link on a report, which is where an anonymous visitor actually needs it.
