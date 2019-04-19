/* eslint-env jquery */
/*global Z: false */

const glov_input = require('./input.js');
const glov_ui = require('./ui.js');
const camera2d = require('./camera2d.js');

const { focuslog } = require('./ui.js');

class GlovUIEditBox {
  constructor(params) {
    this.x = 0;
    this.y = 0;
    this.z = Z.UI; // actually in DOM, so above everything!
    this.w = glov_ui.button_width;
    this.type = 'text';
    // this.h = glov_ui.button_height;
    // this.font_height = glov_ui.font_height;
    this.text = '';
    this.placeholder = '';
    this.initial_focus = false;
    this.applyParams(params);

    this.got_focus_in = false;
    this.got_focus_out = false;
    this.elem = null;
    this.input = null;
    this.submitted = false;
  }
  applyParams(params) {
    if (!params) {
      return;
    }
    for (let f in params) {
      this[f] = params[f];
    }
  }
  getText() {
    return this.text;
  }
  setText(new_text) {
    if (this.input) {
      this.input.value = new_text;
    }
    this.text = new_text;
  }
  focus() {
    glov_ui.focusSteal(this);
  }

  updateFocus() {
    if (this.got_focus_out) {
      if (glov_ui.isFocusedPeek(this)) {
        glov_input.keyDownEdge(glov_input.KEYS.TAB); // eat the TAB
        if (glov_input.keyDown(glov_input.KEYS.SHIFT)) {
          glov_ui.focusPrev(this);
        } else {
          glov_ui.focusNext(this);
        }
      }
      this.got_focus_out = false;
    }
    if (this.got_focus_in) {
      glov_input.keyDownEdge(glov_input.KEYS.TAB); // eat the TAB
      glov_ui.focusSteal(this);
      this.got_focus_in = false;
    }
    let focused = glov_ui.focusCheck(this);
    if (focused && this.input && document.activeElement !== this.input) {
      this.input.focus();
    }
    if (!focused && this.input && document.activeElement === this.input) {
      this.input.blur();
    }

    if (focused && glov_input.keyDownEdge(glov_input.KEYS.ESC)) {
      if (this.text) {
        this.setText('');
      } else {
        glov_ui.focusCanvas();
      }
    }
    return focused;
  }

  run(params) {
    this.applyParams(params);
    let focused = this.updateFocus();

    glov_ui.this_frame_edit_boxes.push(this);
    let elem = glov_ui.getElem();
    if (elem !== this.elem) {
      if (elem) {
        // new DOM element, initialize
        elem.textContent = '';
        let form = document.createElement('form');
        let input = document.createElement('input');
        input.setAttribute('type', this.type);
        input.setAttribute('placeholder', this.placeholder);
        input.setAttribute('tabindex', 2);
        input.addEventListener('focusin', (ev) => {
          focuslog('EditBox:focusin', this);
          this.got_focus_in = true;
          ev.preventDefault();
        }, true);
        input.addEventListener('focusout', (ev) => {
          focuslog('EditBox:focusout', this);
          this.got_focus_out = true;
          ev.preventDefault();
        }, true);
        form.addEventListener('submit', (ev) => {
          ev.preventDefault();
          this.submitted = true;
        }, true);
        form.appendChild(input);
        let span = document.createElement('span');
        span.setAttribute('tabindex', 3);
        form.appendChild(span);
        elem.appendChild(form);
        input.value = this.text;
        this.input = input;
        if (this.initial_focus) {
          input.focus();
        }
      } else {
        this.input = null;
      }
      this.submitted = false;
      this.elem = elem;
    } else {
      if (this.input) {
        this.text = this.input.value;
      }
    }
    if (elem) {
      let pos = camera2d.htmlPos(this.x, this.y);
      elem.style.left = `${pos[0]}%`;
      elem.style.top = `${pos[1]}%`;
      let size = camera2d.htmlSize(this.w, this.h);
      elem.style.width = `${size[0]}%`;
    }

    if (focused) {
      // keyboard input is handled by the INPUT element, but allow mouse events to trickle
      glov_input.eatAllKeyboardInput();
    }

    if (this.submitted) {
      this.submitted = false;
      return this.SUBMIT;
    }
    return null;
  }
  unrun() {
    // remove from DOM or hide
    this.elem = null;
    this.input = null;
  }
}
GlovUIEditBox.prototype.SUBMIT = 'submit';

export function create(params) {
  return new GlovUIEditBox(params);
}
