/**
 * Accessibility Solution Examples
 * 
 * This file contains examples of common accessibility issues found across various websites
 * and how to fix them, categorized by their difficulty level.
 */

const accessibilityIssues = {
    /**
     * EASY FIXES
     * These issues can be fixed by changing a single attribute or adding a simple attribute,
     * with minimal context needed beyond the element itself.
     */
    easy: [
      {
        issue: "image-alt",
        level: "A",
        impact: "Critical",
        description: "Images must have alternative text",
        example: {
          before: `<img src="product-image.jpg">`,
          after: `<img src="product-image.jpg" alt="Chocolate bar product">`,
        },
        wcagLink: "https://www.w3.org/WAI/WCAG21/Techniques/html/H37.html"
      },
      {
        issue: "button-name",
        level: "A",
        impact: "Critical",
        description: "Buttons must have discernible text",
        example: {
          before: `<button class="close-modal"></button>`,
          after: `<button class="close-modal" aria-label="Close modal">`,
        },
        wcagLink: "https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html"
      },
      {
        issue: "link-name",
        level: "A",
        impact: "Serious",
        description: "Links must have discernible text",
        example: {
          before: `<a href="/en-us/"><span class="icon icon-logo-black"></span></a>`,
          after: `<a href="/en-us/" aria-label="Wilson logo"><span class="icon icon-logo-black"></span></a>`,
        },
        wcagLink: "https://www.w3.org/WAI/WCAG21/Techniques/general/G91.html"
      },
      {
        issue: "aria-required-attr",
        level: "A",
        impact: "Critical",
        description: "Required ARIA attributes must be provided",
        example: {
          before: `<span role="heading" class="h6">PRODUCT BRANDS</span>`,
          after: `<span role="heading" class="h6" aria-level="6">PRODUCT BRANDS</span>`,
        },
        wcagLink: "https://www.w3.org/TR/wai-aria-1.1/#usage_intro"
      },
      {
        issue: "aria-allowed-attr",
        level: "A",
        impact: "Critical",
        description: "Elements must only use supported ARIA attributes",
        example: {
          before: `<dt aria-level="3">Product Description</dt>`,
          after: `<dt>Product Description</dt>`,
        },
        wcagLink: "https://www.w3.org/TR/wai-aria-1.1/#state_prop_taxonomy"
      },
      {
        issue: "aria-prohibited-attr",
        level: "A",
        impact: "Serious",
        description: "Elements must only use permitted ARIA attributes",
        example: {
          before: `<span class="icon icon-facebook" aria-label="icon facebook">`,
          after: `<span class="icon icon-facebook" aria-label="icon facebook" role="img">`,
        },
        wcagLink: "https://www.w3.org/TR/wai-aria-1.1/#roles"
      },
      {
        issue: "select-name",
        level: "A",
        impact: "Critical",
        description: "Select element must have an accessible name",
        example: {
          before: `<select class="form-group country-selector-select">`,
          after: `<select class="form-group country-selector-select" aria-label="Select country">`,
        },
        wcagLink: "https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html"
      },
      {
        issue: "aria-input-field-name",
        level: "A",
        impact: "Serious",
        description: "ARIA input fields must have an accessible name",
        example: {
          before: `<div class="cmp-slider quick-links default-slider" role="slider">`,
          after: `<div class="cmp-slider quick-links default-slider" role="slider" aria-label="Product selection slider">`,
        },
        wcagLink: "https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html"
      },
      {
        issue: "frame-title",
        level: "A",
        impact: "Serious",
        description: "Frames must have an accessible name",
        example: {
          before: `<iframe src="https://example.com/map">`,
          after: `<iframe src="https://example.com/map" title="Store location map">`,
        },
        wcagLink: "https://www.w3.org/WAI/WCAG21/Techniques/html/H64.html"
      },
      {
        issue: "html-has-lang",
        level: "A",
        impact: "Serious",
        description: "<html> element must have a lang attribute",
        example: {
          before: `<html>`,
          after: `<html lang="en">`,
        },
        wcagLink: "https://www.w3.org/WAI/WCAG21/Techniques/html/H57.html"
      },
      {
        issue: "html-lang-valid",
        level: "A",
        impact: "Serious",
        description: "<html> element must have a valid value for the lang attribute",
        example: {
          before: `<html lang="en-us">`,
          after: `<html lang="en-US">`,
        },
        wcagLink: "https://www.w3.org/WAI/WCAG21/Techniques/html/H57.html"
      },
      {
        issue: "svg-img-alt",
        level: "A",
        impact: "Serious",
        description: "<svg> elements with an img role must have an alternative text",
        example: {
          before: `<svg role="img" viewBox="0 0 100 100">...</svg>`,
          after: `<svg role="img" viewBox="0 0 100 100" aria-label="Company logo">...</svg>`,
        },
        wcagLink: "https://www.w3.org/WAI/WCAG21/Techniques/general/G94"
      },
      {
        issue: "aria-valid-attr",
        level: "A",
        impact: "Critical",
        description: "ARIA attributes must conform to valid names",
        example: {
          before: `<button aria-labeledby="label1">Submit</button>`,
          after: `<button aria-labelledby="label1">Submit</button>`,
        },
        wcagLink: "https://www.w3.org/TR/wai-aria-1.1/#states_and_properties"
      },
      {
        issue: "aria-roles",
        level: "A",
        impact: "Critical",
        description: "ARIA roles must conform to valid values",
        example: {
          before: `<main role="main-lightbox" id="main-lightbox" class="contentarea__main contentarea__content\n                  grid-main \n                  grid-content\n                  js-content-main\n                  maxWidth-container\" tabindex=\"-1\">`,
          after: `<main role="main" id="main" class="contentarea__main contentarea__content\n                  grid-main \n                  grid-content\n                  js-content-main\n                  maxWidth-container\" tabindex=\"-1\">`,
        },
        wcagLink: "https://www.w3.org/WAI/WCAG21/Techniques/aria/ARIA4.html"
      },
    ],
  
    /**
     * MEDIUM FIXES
     * These issues typically require understanding the relationship between elements
     * or may involve multiple elements, but are still relatively straightforward.
     */
    medium: [
      {
        issue: "aria-hidden-focus",
        level: "A",
        impact: "Serious",
        description: "ARIA hidden element must not be focusable or contain focusable elements",
        example: {
          before: `<div aria-hidden="true">
    <a href="/products/detail.html">Product details</a>
  </div>`,
          after: `<div aria-hidden="true">
    <a href="/products/detail.html" tabindex="-1">Product details</a>
  </div>`,
        },
        wcagLink: "https://www.w3.org/WAI/WCAG22/Understanding/parsing.html"
      },
      {
        issue: "nested-interactive",
        level: "A",
        impact: "Serious",
        description: "Interactive controls must not be nested",
        example: {
          before: `<div class="product-slider__item" tabindex="-1" role="option">
    <div class="product-slider__content">
      <a href="/products/product-detail.html">View details</a>
    </div>
  </div>`,
          after: `<div class="product-slider__item" role="option">
    <div class="product-slider__content">
      <a href="/products/product-detail.html">View details</a>
    </div>
  </div>`,
        },
        wcagLink: "https://www.w3.org/WAI/WCAG22/Understanding/no-keyboard-trap.html"
      },
      {
        issue: "listitem",
        level: "A",
        impact: "Serious",
        description: "<li> elements must be contained in a <ul> or <ol>",
        example: {
          before: `<div class="navigation-menu">
    <li><a href="/products">Products</a></li>
    <li><a href="/about">About</a></li>
  </div>`,
          after: `<div class="navigation-menu" role="list">
    <li><a href="/products">Products</a></li>
    <li><a href="/about">About</a></li>
  </div>`,
        },
        wcagLink: "https://www.w3.org/WAI/WCAG21/Techniques/html/H48.html"
      },
      {
        issue: "dlitem",
        level: "A", 
        impact: "Serious",
        description: "<dt> and <dd> elements must be contained by a <dl>",
        example: {
          before: `<div class="product-specs">
    <dt>Weight</dt>
    <dd>10.5 oz</dd>
    <dt>Dimensions</dt>
    <dd>5 x 3 x 1 inches</dd>
  </div>`,
          after: `<dl class="product-specs">
    <dt>Weight</dt>
    <dd>10.5 oz</dd>
    <dt>Dimensions</dt>
    <dd>5 x 3 x 1 inches</dd>
  </dl>`,
        },
        wcagLink: "https://www.w3.org/WAI/WCAG21/Techniques/html/H40.html"
      },
      {
        issue: "definition-list",
        level: "A",
        impact: "Serious", 
        description: "<dl> elements must only directly contain properly-ordered <dt> and <dd> groups, <script>, <template> or <div> elements",
        example: {
          before: `<dl>
    <span>Product Details:</span>
    <dt>Weight</dt>
    <dd>10.5 oz</dd>
  </dl>`,
          after: `<dl>
    <div>
      <dt>Product Details:</dt>
      <dd>
        <dl>
          <dt>Weight</dt>
          <dd>10.5 oz</dd>
        </dl>
      </dd>
    </div>
  </dl>`,
        },
        wcagLink: "https://html.spec.whatwg.org/multipage/grouping-content.html#the-dl-element"
      },
      {
        issue: "scrollable-region-focusable",
        level: "A",
        impact: "Serious",
        description: "Scrollable region must have keyboard access",
        example: {
          before: `<div class="product-list" style="height: 300px; overflow: auto;">
    <!-- long list of products -->
  </div>`,
          after: `<div class="product-list" style="height: 300px; overflow: auto;" tabindex="0">
    <!-- long list of products -->
  </div>`,
        },
        wcagLink: "https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html"
      },
      {
        issue: "list",
        level: "A",
        impact: "Serious",
        description: "<ul> and <ol> must only directly contain <li>, <script> or <template> elements",
        example: {
          before: `<ul class="product-list">
    <span>Product 1</span>
    <span>Product 2</span>
  </ul>`,
          after: `<ul class="product-list">
    <li>Product 1</li>
    <li>Product 2</li>
  </ul>`,
        },
        wcagLink: "https://www.w3.org/WAI/WCAG21/Techniques/html/H48.html"
      },
      {
        issue: "link-in-text-block",
        level: "A",
        impact: "Serious",
        description: "Links must be distinguishable without relying on color",
        example: {
          before: `<p>Read our <a href="/policy" style="color: #0000FF;">privacy policy</a> for more information.</p>`,
          after: `<p>Read our <a href="/policy" style="color: #0000FF; text-decoration: underline;">privacy policy</a> for more information.</p>`,
        },
        wcagLink: "https://www.w3.org/WAI/WCAG21/Techniques/general/G183.html"
      },
      {
        issue: "label",
        level: "A",
        impact: "Critical",
        description: "Form elements must have labels",
        example: {
          before: `<input type="text" id="name" placeholder="Full Name">`,
          after: `<label for="name">Full Name</label>
  <input type="text" id="name">`,
        },
        wcagLink: "https://www.w3.org/WAI/WCAG21/Techniques/failures/F68.html"
      },
    ],
  
    /**
     * HARD FIXES
     * These issues typically require structural changes, understanding of complex
     * relationships between elements, or may involve significant redesign.
     */
    hard: [
      {
        issue: "aria-required-parent",
        level: "A",
        impact: "Critical",
        description: "Certain ARIA roles must be contained by particular parents",
        example: {
          before: `<div class="product-slider" id="tns1">
    <div class="product-slider__item" id="tns1-item0" role="option">Product 1</div>
    <div class="product-slider__item" id="tns1-item1" role="option">Product 2</div>
  </div>`,
          after: `<div class="product-slider" id="tns1" role="listbox">
    <div class="product-slider__item" id="tns1-item0" role="option">Product 1</div>
    <div class="product-slider__item" id="tns1-item1" role="option">Product 2</div>
  </div>`,
        },
        wcagLink: "https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html"
      },
      {
        issue: "aria-required-children",
        level: "A",
        impact: "Critical",
        description: "Certain ARIA roles must contain particular children",
        example: {
          before: `<div role="list">
    <span>Item 1</span>
    <span>Item 2</span>
  </div>`,
          after: `<div role="list">
    <div role="listitem">Item 1</div>
    <div role="listitem">Item 2</div>
  </div>`,
        },
        wcagLink: "https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html"
      },
      {
        issue: "color-contrast",
        level: "AA",
        impact: "Serious",
        description: "Elements must meet minimum color contrast ratio thresholds",
        example: {
          before: `<p style="color: #8f8f8f; background-color: #ffffff;">Product description text</p>`,
          after: `<p style="color: #666666; background-color: #ffffff;">Product description text</p>`,
        },
        wcagLink: "https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html"
      },
      {
        issue: "target-size",
        level: "AA",
        impact: "Serious",
        description: "All touch targets must be 24px large, or leave sufficient space",
        example: {
          before: `<a href="/product" style="padding: 4px; font-size: 12px;">View product</a>`,
          after: `<a href="/product" style="padding: 12px; font-size: 12px; display: inline-block; min-height: 24px; min-width: 24px;">View product</a>`,
        },
        wcagLink: "https://w3c.github.io/wcag/understanding/target-size-minimum.html"
      },
      {
        issue: "meta-viewport",
        level: "AA",
        impact: "Critical",
        description: "Zooming and scaling must not be disabled",
        example: {
          before: `<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">`,
          after: `<meta name="viewport" content="width=device-width, initial-scale=1.0">`,
        },
        wcagLink: "https://www.w3.org/WAI/WCAG21/Understanding/resize-text.html"
      },
      {
        issue: "role-img-alt",
        level: "A",
        impact: "Serious",
        description: "[role='img'] elements must have an alternative text",
        example: {
          before: `<div role="img" class="product-hero-image"></div>`,
          after: `<div role="img" class="product-hero-image" aria-label="Featured chocolate product"></div>`,
        },
        wcagLink: "https://www.w3.org/WAI/WCAG21/Techniques/aria/ARIA4.html"
      },
    ]
  };

export { accessibilityIssues };

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
    'aria-valid-attr-value' : 'Ensure the value inside each attribute is spelled correctly and corresponds to a valid value.',
    
    // Level A - Serious issues
    'aria-hidden-focus': 'Add `tabindex="-1"` to all focusable elements inside containers with `aria-hidden="true"` or remove the aria-hidden attribute.',
    'nested-interactive': 'Remove conflicting interactive roles from elements or restructure to avoid nesting interactive elements.',
    'dlitem': 'Ensure `<dt>` and `<dd>` elements are contained within a `<dl>` element.',
    'definition-list': 'Ensure `<dl>` elements contain properly-ordered `<dt>` and `<dd>` groups only.',
    'link-name': 'Add accessible names to links using aria-label or visible text content.',
    'aria-prohibited-attr': 'Remove ARIA attributes that are not permitted on the elements.',
    'aria-input-field-name': 'Add accessible names to ARIA input fields using aria-label or aria-labelledby.',
    'role-img-alt': 'Add aria-label or aria-labelledby to elements with role="img".',
    'scrollable-region-focusable': 'Ensure scrollable regions are keyboard accessible by adding tabindex="0" to the container.',
    'link-in-text-block': 'Add a distinct style to links that appear in blocks of text to make them stand out from the text.',
    'listitem': 'Ensure all `<li>` elements are properly contained within `<ul>` or `<ol>` elements, or add `role="list"` to parent containers.',
    'aria-command-name': 'Add accessible names to elements with command roles using aria-label or aria-labelledby attributes.',
    'aria-roles': 'Ensure the main element is properly announced by screen readers.',
    
    // Level AA - Serious issues
    'color-contrast': 'Ensure text has sufficient contrast against its background (4.5:1 for normal text, 3:1 for large text).',
    'target-size': 'Make touch targets at least 44x44 pixels for better mobile accessibility.',
    
    // Level AA - Critical issues
    'meta-viewport': 'Remove user-scalable=no from the viewport meta tag to allow zooming.'
  };

  export { accessibilitySolutions };

/**
 * Accessibility suggestions for common WCAG issues
 * This file contains standardized suggestions for accessibility issues
 * used in generating reports
 * Used for Enhancing accessibility for the top 10 most-visited pages section, specifically "Suggestion" column
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
    'label': 'Add explicit label elements connected to inputs using the for attribute.',
    'aria-valid-attr-value': 'Correct mistakes such as `aria-hidden="rtue"` or `aria-expanded="null"`',
  
    // Level A - Serious issues
    'aria-hidden-focus': 'Remove `aria-hidden="true"` from elements that contain focusable elements, or ensure all focusable elements within hidden containers also have `tabindex="-1"` if the elements should genuinely be hidden from screen readers.',
    'nested-interactive': 'Remove tabindex="-1".',
    'dlitem': 'Ensure `<dt>` and `<dd>` elements are properly contained within a `<dl>` element.',
    'definition-list': 'Restructure the definition list to include only properly-ordered `<dt>` and `<dd>` groups.',
    'link-name': 'Add aria-label attribute to links containing only images or icons without alt text.',
    'aria-prohibited-attr': 'Add `role="figure"` attribute to span elements that contain images.',
    'aria-input-field-name': 'Add `aria-label` attribute to sliders.',
    'role-img-alt': 'Add an accessible name to elements with `role="img"` using `aria-label` or `aria-labelledby` attributes.',
    'scrollable-region-focusable': 'Make scrollable regions keyboard accessible by adding tabindex="0" and ensuring proper focus management.',
    'frame-title': 'Add title attributes to all iframe elements to describe their purpose.',
    'listitem': 'Ensure all `<li>` elements are properly contained within `<ul>` or `<ol>` elements, or add role="list" to parent containers.',
    'list': 'Ensure list elements only contain permitted child elements.',
    'frame-focusable-content': 'Remove tabindex="-1" attribute from iframe elements that contain interactive content.',
    'link-in-text-block': 'Ensure all links that appear in blocks of text have a color contrast difference of at least 3:1 with the surrounding text to ensure that users who cannot distinguish between the colors can still find the link, or give it a distinct style to make it stand out from the text.',
    'aria-command-name': 'Ensure that each element with `role="link"`, `role="button"`, or `role="menuitem"` has either inner text that is discernible to screen reader users; Non-empty aria-label attribute; or aria-labelledby pointing to element with text which is discernible to screen reader users.',
    'aria-roles': 'Ensure that the main element is properly announced by screen readers.',
    
    // Level AA - Serious issues
    'color-contrast': 'Increase the contrast between the button text and background colors. Ensure a minimum contrast ratio of 4.5:1 for normal text and 3:1 for large text (at least 18pt or 14pt bold).',
    'target-size': 'Increase the size of the search button to at least 24x24 pixels (WCAG AA recommendation) to make it easier to tap on mobile devices',
  
    // Level AA - Critical issues
    'meta-viewport': 'Remove `user-scalable=no` from the viewport meta tag to allow users to zoom the page.'
  };
  
  export { accessibilitySuggestions }; 

/**
 * Accessibility user impact descriptions for common WCAG issues
 * This file contains standardized descriptions of how accessibility issues affect users
 * used in generating reports
 * Used for Enhancing accessibility for the top 10 most-visited pages section, specifically "How is the user affected" column
 */

const accessibilityUserImpact = {
    // Level A - Critical issues
    'aria-required-parent': 'Screen reader users receive incomplete or incorrect information about content organization. When elements require specific parent roles but don\'t have them, the hierarchical relationship is broken, making navigation confusing and unpredictable.',
    'aria-allowed-attr': 'Screen reader users receive misleading or nonsensical information when elements use ARIA attributes they don\'t support. This causes confusion when the announced content doesn\'t match the expected behavior of the element.',
    'aria-required-attr': 'Screen reader users receive incomplete information about an element\'s purpose or state when required ARIA attributes are missing. This prevents users from understanding how to interact with elements or their current state.',
    'button-name': 'Screen reader users cannot determine the purpose of buttons without discernible text. When encountering unnamed buttons, users must guess their function based on context, making interfaces unpredictable and potentially unusable.',
    'image-alt': 'Screen reader users receive no information about images without alternative text. Important visual content becomes completely inaccessible, leaving users with significant information gaps.',
    'aria-required-children': 'Screen reader users receive incomplete information about content structure when ARIA roles requiring specific children lack those children. This breaks expected relationships and makes navigation unpredictable.',
    'aria-valid-attr-value':'Screen readers or keyboard navigation relys on the value of the attribute to determine the purpose of the element. If the value is incorrect, the user will not be able to interact with the element and will lead to loss of content context and navigational issues.',
  
    // Level A - Serious issues
    'aria-hidden-focus': 'Keyboard and screen reader users experience confusing interfaces when elements hidden from screen readers (aria-hidden="true") remain focusable. Users can focus on elements they cannot perceive, creating a disconnected experience where their cursor appears to "disappear".',
    'nested-interactive': 'Screen reader and keyboard users face accessibility barriers when interactive controls are nested within other interactive elements. This creates unpredictable behavior, incomplete announcements, and potentially unusable features that trap or skip focus.',
    'dlitem': 'Screen reader users receive incomplete or incorrect information about definition terms and their descriptions when list items are not properly contained in a definition list. This breaks the semantic connection between terms and their definitions.',
    'definition-list': 'Screen reader users receive incomplete or incorrect information about content relationships in definition lists when they\'re improperly structured. This breaks the semantic connection between terms and their definitions.',
    'link-name': 'Screen reader users cannot determine the destination or purpose of links without discernible text. This forces users to follow links without knowing where they lead or skip potentially important content.',
    'aria-prohibited-attr': 'Screen reader users receive contradictory or misleading information when elements use ARIA attributes that are explicitly forbidden on those elements. This creates confusion and unpredictable behavior.',
    'aria-input-field-name': 'Screen reader users cannot identify the purpose of input fields without accessible names. When encountering unnamed fields, users must guess their purpose, making forms difficult or impossible to complete accurately.',
    'role-img-alt': 'Screen reader users receive no information about elements with role="img" that lack alternative text. This makes visual content completely inaccessible, similar to images without alt text.',
    'scrollable-region-focusable': 'Keyboard users cannot access content in scrollable regions that aren\'t keyboard accessible. Content becomes completely inaccessible if it can only be reached by scrolling with a mouse.',
    'list': 'Users who navigate using keyboards or other assistive devices might struggle to move through improperly structured lists. Properly marked-up lists allow users to navigate efficiently from one list item to the next.',
    'listitem': 'Screen reader users receive incorrect or incomplete information about list structures, making content organization difficult to understand.',
    'frame-title': 'Screen reader users cannot determine the purpose of iframes without titles, making it difficult to understand embedded content.',
    'label': 'Users who navigate using keyboards or other assistive devices might struggle to identify and interact with unlabeled form elements. Proper labels help users quickly identify and interact with the correct fields, improving their overall experience.',
    'select-name': 'If a `<select>` element does not have a proper accessible name, users may not understand its purpose. Screen readers might announce it as "combo box" or "list box" without providing any context, making it difficult for users to know what options they are selecting from.',
    'frame-focusable-content': 'Screen reader and keyboard users cannot access content inside frames that aren\'t properly configured for keyboard navigation. This creates barriers where users can see that content exists but cannot reach or interact with it, making portions of the page completely unusable.',
    'link-in-text-block': 'Users with visual disabilities or cognitive impairments struggle to identify links that aren\'t visually distinct from surrounding text. When links blend in with regular text, they become invisible to many users who cannot distinguish them by color alone, causing important interactive elements to be missed.',
    'aria-command-name': 'Screen reader users are not able to discern the purpose of elements with `role="link"`, `role="button"`, or `role="menuitem"` that do not have an accessible name.',
    'aria-roles': 'Screen reader users receive incorrect or incomplete information about the structure of a webpage. When the main element is not properly announced, users may not understand the overall layout or navigation, making it difficult to find and interact with important content.',
  
    // Level AA - Serious issues
    'color-contrast': 'Users with low vision, color blindness, or those in high-glare environments struggle to read text with insufficient contrast. This causes eye strain and can make content completely unreadable for some users.',
    'target-size': 'Users with motor impairments struggle to interact with touch targets smaller than 24px. Small buttons or links are difficult to tap accurately, causing frustration, accidental activations, and preventing successful task completion.',
  
    // Level AA - Critical issues
    'meta-viewport': 'Users who need to zoom webpages for better visibility cannot do so when zooming is disabled. This makes content completely inaccessible for users with low vision who rely on zoom functionality.'
  };
  
  export { accessibilityUserImpact }; 