/**
 * accessibilityIssueImpact
 * Maps axe-core issue IDs to their impact level ('Critical' or 'Serious').
 * This is used to display the correct impact in accessibility reports when the impact is not present in the data.
 */
const accessibilityIssuesImpact = {
  // Critical impact issues (Level A, typically)
  'aria-required-parent': 'Critical',
  'aria-allowed-attr': 'Critical',
  'aria-required-attr': 'Critical',
  'button-name': 'Critical',
  'image-alt': 'Critical',
  'aria-required-children': 'Critical',
  'aria-valid-attr-value': 'Critical',
  'meta-viewport': 'Critical',
  'select-name': 'Critical',

  // Serious impact issues (Level AA, typically)
  'aria-hidden-focus': 'Serious',
  'nested-interactive': 'Serious',
  'dlitem': 'Serious',
  'definition-list': 'Serious',
  'link-name': 'Serious',
  'aria-prohibited-attr': 'Serious',
  'aria-input-field-name': 'Serious',
  'role-img-alt': 'Serious',
  'scrollable-region-focusable': 'Serious',
  'frame-title': 'Serious',
  'list': 'Serious',
  'frame-focusable-content': 'Serious',
  'link-in-text-block': 'Serious',
  'aria-command-name': 'Serious',
  'aria-roles': 'Serious',
  'color-contrast': 'Serious',
  'target-size': 'Serious',
};

export { accessibilityIssuesImpact };

/**
 * Accessibility solutions for common WCAG issues
 * This file contains standardized solutions for accessibility issues
 * used in generating reports
 * Used for Quick Wins section, specifically "How to solve" column
 */

const accessibilitySolutions = {
  // Level A - Critical issues
  'aria-required-parent': 'Add appropriate parent containers with required roles (e.g., add `role="listbox"` to parent containers of elements with `role="option"`). ',
  'aria-allowed-attr': 'Remove ARIA attributes (i.e. aria-level="3") from elements that do not support them like `<dt>`.',
  'aria-required-attr': 'Add required ARIA attributes to elements that use ARIA roles.',
  'button-name': 'Add accessible names to buttons using aria-label or visible text content.',
  'image-alt': 'Add alt text to images to provide alternative text for screen readers.',
  'aria-required-children': 'Ensure elements with specific roles contain the required child elements.',
  'aria-valid-attr-value': 'Ensure the value inside each attribute is spelled correctly and corresponds to a valid value.',

  // Level A - Serious issues
  'aria-hidden-focus': 'Add `tabindex="-1"` to all focusable elements inside containers with `aria-hidden="true"` or remove the aria-hidden attribute.',
  'nested-interactive': 'Remove conflicting interactive roles from elements or restructure to avoid nesting interactive elements.',
  dlitem: 'Ensure `<dt>` and `<dd>` elements are contained within a `<dl>` element.',
  'definition-list': 'Ensure `<dl>` elements contain properly-ordered `<dt>` and `<dd>` groups only.',
  'link-name': 'Add accessible names to links using aria-label or visible text content.',
  'aria-prohibited-attr': 'Remove ARIA attributes that are not permitted on the elements.',
  'aria-input-field-name': 'Add accessible names to ARIA input fields using aria-label or aria-labelledby.',
  'role-img-alt': 'Add aria-label or aria-labelledby to elements with role="img".',
  'scrollable-region-focusable': 'Ensure scrollable regions are keyboard accessible by adding tabindex="0" to the container.',
  'link-in-text-block': 'Add a distinct style to links that appear in blocks of text to make them stand out from the text.',
  listitem: 'Ensure all `<li>` elements are properly contained within `<ul>` or `<ol>` elements, or add `role="list"` to parent containers.',
  'aria-command-name': 'Add accessible names to elements with command roles using aria-label or aria-labelledby attributes.',
  'aria-roles': 'Ensure the main element is properly announced by screen readers.',

  // Level AA - Serious issues
  'color-contrast': 'Ensure text has sufficient contrast against its background (4.5:1 for normal text, 3:1 for large text).',
  'target-size': 'Make touch targets at least 44x44 pixels for better mobile accessibility.',

  // Level AA - Critical issues
  'meta-viewport': 'Remove user-scalable=no from the viewport meta tag to allow zooming.',
};

export { accessibilitySolutions };

/**
 * Accessibility suggestions for common WCAG issues
 * This file contains standardized suggestions for accessibility issues
 * used in generating reports
 * Used for Enhancing accessibility for the top 10 most-visited pages section,
 * specifically "Suggestion" column
 */

const accessibilitySuggestions = {
  // Level A - Critical issues
  'aria-required-parent': 'Add `role="group"` or `role="listbox"` attribute to parents of elements with `role="option"` attribute.',
  'aria-allowed-attr': 'Remove `aria-level` attribute from the HTML elements that do not support it.',
  'aria-required-attr': 'Add `aria-level` attribute to elements that are used as headings.',
  'button-name': 'Add aria-label attributes to buttons that lack text content, especially carousel navigation buttons.',
  'image-alt': 'Ensure all informative `<img>` elements have short, descriptive alternate text and all decorative `<img>` elements have empty alt attributes (e.g. `alt=""`).',
  'aria-required-children': 'Ensure elements with aria-controls attribute has a parent with role like "group".',
  'select-name': 'Add aria-label attribute to select tags that do not have explicit labels.',
  label: 'Add explicit label elements connected to inputs using the for attribute.',
  'aria-valid-attr-value': 'Correct mistakes such as `aria-hidden="rtue"` or `aria-expanded="null"`',

  // Level A - Serious issues
  'aria-hidden-focus': 'Remove `aria-hidden="true"` from elements that contain focusable elements, or ensure all focusable elements within hidden containers also have `tabindex="-1"` if the elements should genuinely be hidden from screen readers.',
  'nested-interactive': 'Remove tabindex="-1".',
  dlitem: 'Ensure `<dt>` and `<dd>` elements are properly contained within a `<dl>` element.',
  'definition-list': 'Restructure the definition list to include only properly-ordered `<dt>` and `<dd>` groups.',
  'link-name': 'Add aria-label attribute to links containing only images or icons without alt text.',
  'aria-prohibited-attr': 'Add `role="figure"` attribute to span elements that contain images.',
  'aria-input-field-name': 'Add `aria-label` attribute to sliders.',
  'role-img-alt': 'Add an accessible name to elements with `role="img"` using `aria-label` or `aria-labelledby` attributes.',
  'scrollable-region-focusable': 'Make scrollable regions keyboard accessible by adding tabindex="0" and ensuring proper focus management.',
  'frame-title': 'Add title attributes to all iframe elements to describe their purpose.',
  listitem: 'Ensure all `<li>` elements are properly contained within `<ul>` or `<ol>` elements, or add role="list" to parent containers.',
  list: 'Ensure list elements only contain permitted child elements.',
  'frame-focusable-content': 'Remove tabindex="-1" attribute from iframe elements that contain interactive content.',
  'link-in-text-block': 'Ensure all links that appear in blocks of text have a color contrast difference of at least 3:1 with the surrounding text to ensure that users who cannot distinguish between the colors can still find the link, or give it a distinct style to make it stand out from the text.',
  'aria-command-name': 'Ensure that each element with `role="link"`, `role="button"`, or `role="menuitem"` has either inner text that is discernible to screen reader users; Non-empty aria-label attribute; or aria-labelledby pointing to element with text which is discernible to screen reader users.',
  'aria-roles': 'Ensure that the main element is properly announced by screen readers.',

  // Level AA - Serious issues
  'color-contrast': 'Increase the contrast between the button text and background colors. Ensure a minimum contrast ratio of 4.5:1 for normal text and 3:1 for large text (at least 18pt or 14pt bold).',
  'target-size': 'Increase the size of the search button to at least 24x24 pixels (WCAG AA recommendation) to make it easier to tap on mobile devices',

  // Level AA - Critical issues
  'meta-viewport': 'Remove `user-scalable=no` from the viewport meta tag to allow users to zoom the page.',
};

export { accessibilitySuggestions };

/**
 * Accessibility user impact descriptions for common WCAG issues
 * This file contains standardized descriptions of how accessibility issues affect users
 * used in generating reports
 * Used for Enhancing accessibility for the top 10 most-visited pages section,
 * specifically "How is the user affected" column
 */

const accessibilityUserImpact = {
  // Level A - Critical issues
  'aria-required-parent': 'Screen reader users receive incomplete or incorrect information about content organization. When elements require specific parent roles but don\'t have them, the hierarchical relationship is broken, making navigation confusing and unpredictable.',
  'aria-allowed-attr': 'Screen reader users receive misleading or nonsensical information when elements use ARIA attributes they don\'t support. This causes confusion when the announced content doesn\'t match the expected behavior of the element.',
  'aria-required-attr': 'Screen reader users receive incomplete information about an element\'s purpose or state when required ARIA attributes are missing. This prevents users from understanding how to interact with elements or their current state.',
  'button-name': 'Screen reader users cannot determine the purpose of buttons without discernible text. When encountering unnamed buttons, users must guess their function based on context, making interfaces unpredictable and potentially unusable.',
  'image-alt': 'Screen reader users receive no information about images without alternative text. Important visual content becomes completely inaccessible, leaving users with significant information gaps.',
  'aria-required-children': 'Screen reader users receive incomplete information about content structure when ARIA roles requiring specific children lack those children. This breaks expected relationships and makes navigation unpredictable.',
  'aria-valid-attr-value': 'Screen readers or keyboard navigation relys on the value of the attribute to determine the purpose of the element. If the value is incorrect, the user will not be able to interact with the element and will lead to loss of content context and navigational issues.',

  // Level A - Serious issues
  'aria-hidden-focus': 'Keyboard and screen reader users experience confusing interfaces when elements hidden from screen readers (aria-hidden="true") remain focusable. Users can focus on elements they cannot perceive, creating a disconnected experience where their cursor appears to "disappear".',
  'nested-interactive': 'Screen reader and keyboard users face accessibility barriers when interactive controls are nested within other interactive elements. This creates unpredictable behavior, incomplete announcements, and potentially unusable features that trap or skip focus.',
  dlitem: 'Screen reader users receive incomplete or incorrect information about definition terms and their descriptions when list items are not properly contained in a definition list. This breaks the semantic connection between terms and their definitions.',
  'definition-list': 'Screen reader users receive incomplete or incorrect information about content relationships in definition lists when they\'re improperly structured. This breaks the semantic connection between terms and their definitions.',
  'link-name': 'Screen reader users cannot determine the destination or purpose of links without discernible text. This forces users to follow links without knowing where they lead or skip potentially important content.',
  'aria-prohibited-attr': 'Screen reader users receive contradictory or misleading information when elements use ARIA attributes that are explicitly forbidden on those elements. This creates confusion and unpredictable behavior.',
  'aria-input-field-name': 'Screen reader users cannot identify the purpose of input fields without accessible names. When encountering unnamed fields, users must guess their purpose, making forms difficult or impossible to complete accurately.',
  'role-img-alt': 'Screen reader users receive no information about elements with role="img" that lack alternative text. This makes visual content completely inaccessible, similar to images without alt text.',
  'scrollable-region-focusable': 'Keyboard users cannot access content in scrollable regions that aren\'t keyboard accessible. Content becomes completely inaccessible if it can only be reached by scrolling with a mouse.',
  list: 'Users who navigate using keyboards or other assistive devices might struggle to move through improperly structured lists. Properly marked-up lists allow users to navigate efficiently from one list item to the next.',
  listitem: 'Screen reader users receive incorrect or incomplete information about list structures, making content organization difficult to understand.',
  'frame-title': 'Screen reader users cannot determine the purpose of iframes without titles, making it difficult to understand embedded content.',
  label: 'Users who navigate using keyboards or other assistive devices might struggle to identify and interact with unlabeled form elements. Proper labels help users quickly identify and interact with the correct fields, improving their overall experience.',
  'select-name': 'If a `<select>` element does not have a proper accessible name, users may not understand its purpose. Screen readers might announce it as "combo box" or "list box" without providing any context, making it difficult for users to know what options they are selecting from.',
  'frame-focusable-content': 'Screen reader and keyboard users cannot access content inside frames that aren\'t properly configured for keyboard navigation. This creates barriers where users can see that content exists but cannot reach or interact with it, making portions of the page completely unusable.',
  'link-in-text-block': 'Users with visual disabilities or cognitive impairments struggle to identify links that aren\'t visually distinct from surrounding text. When links blend in with regular text, they become invisible to many users who cannot distinguish them by color alone, causing important interactive elements to be missed.',
  'aria-command-name': 'Screen reader users are not able to discern the purpose of elements with `role="link"`, `role="button"`, or `role="menuitem"` that do not have an accessible name.',
  'aria-roles': 'Screen reader users receive incorrect or incomplete information about the structure of a webpage. When the main element is not properly announced, users may not understand the overall layout or navigation, making it difficult to find and interact with important content.',

  // Level AA - Serious issues
  'color-contrast': 'Users with low vision, color blindness, or those in high-glare environments struggle to read text with insufficient contrast. This causes eye strain and can make content completely unreadable for some users.',
  'target-size': 'Users with motor impairments struggle to interact with touch targets smaller than 24px. Small buttons or links are difficult to tap accurately, causing frustration, accidental activations, and preventing successful task completion.',

  // Level AA - Critical issues
  'meta-viewport': 'Users who need to zoom webpages for better visibility cannot do so when zooming is disabled. This makes content completely inaccessible for users with low vision who rely on zoom functionality.',
};

export { accessibilityUserImpact };