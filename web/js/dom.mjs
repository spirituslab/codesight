// Safe DOM creation helpers — replaces innerHTML + onclick string patterns

/**
 * Create an element with attributes and children.
 * @param {string} tag
 * @param {object} attrs - { class, id, onclick, textContent, innerHTML, ... }
 * @param {(Element|string)[]} children
 * @returns {HTMLElement}
 */
export function el(tag, attrs = {}, children = []) {
  const elem = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class' || key === 'className') {
      elem.className = value;
    } else if (key === 'textContent') {
      elem.textContent = value;
    } else if (key === 'innerHTML') {
      elem.innerHTML = value;
    } else if (key.startsWith('on') && typeof value === 'function') {
      elem.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(elem.style, value);
    } else {
      elem.setAttribute(key, value);
    }
  }

  for (const child of children) {
    if (typeof child === 'string') {
      elem.appendChild(document.createTextNode(child));
    } else if (child instanceof Node) {
      elem.appendChild(child);
    }
  }

  return elem;
}

/**
 * Clear an element's children and append new ones.
 */
export function replaceChildren(parent, ...children) {
  parent.textContent = '';
  for (const child of children) {
    if (typeof child === 'string') {
      parent.appendChild(document.createTextNode(child));
    } else if (child instanceof Node) {
      parent.appendChild(child);
    }
  }
}

/**
 * Create a list of clickable items.
 */
export function clickableList(items, className = '') {
  const ul = el('ul', { class: className });
  for (const item of items) {
    const li = el('li', {});
    if (item.html) li.innerHTML = item.html;
    else if (item.text) li.textContent = item.text;
    if (item.onclick) li.addEventListener('click', item.onclick);
    if (item.class) li.className = item.class;
    ul.appendChild(li);
  }
  return ul;
}
