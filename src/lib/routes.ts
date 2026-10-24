/**
 * Pages a buyer opens from an agent's link or inside an agency's site: no
 * amoblaIA navigation, footer, tour or advertising tags.
 */
export function isBareRoute(pathname: string | null | undefined) {
  return Boolean(
    pathname &&
      (pathname.startsWith("/ficha/") || pathname.startsWith("/embed/")),
  );
}
