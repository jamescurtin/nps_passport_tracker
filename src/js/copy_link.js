import { announce } from "./live";

/**
 * Copy a URL to the clipboard. Without the async clipboard API (insecure
 * context, denied permission), show the URL in a read-only field, select it
 * and ask the user to copy it.
 * @param {string} url - Link to copy
 * @param {Element} container - Where the fallback field goes
 * @param {object} [nav] - `navigator`-like object (for tests)
 * @return {Promise<boolean>} true if the clipboard was written
 */
export async function copyLink(url, container, nav = navigator) {
  try {
    await nav.clipboard.writeText(url);
    container.querySelector(".link-field")?.remove();
    announce("Link copied", 0);
    return true;
  } catch {
    let field = container.querySelector(".link-field");
    if (!field) {
      field = document.createElement("input");
      field.type = "text";
      field.readOnly = true;
      field.className = "link-field";
      field.setAttribute("aria-label", "Park link");
      container.append(field);
    }
    field.value = url;
    field.focus();
    field.select();
    announce("Link selected. Copy it with the keyboard.", 0);
    return false;
  }
}
