// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Textarea - Multi-line text input widget for Plauna
 * Provides textarea functionality with multiple states and variants
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { tone as toneOf, fieldStyles, TONES } from '../shared/appearance.js';

let _textareaSequence = 0;

function _newTextareaId() {
    return `textarea-${Date.now()}-${++_textareaSequence}`;
}

export class Textarea extends UINode {
    // Widget metadata
    static id = 'textarea';
    static name = 'Textarea';
    static category = 'form';
    static icon = '📄';
    static description = 'Multi-line text input';
    static tags = ['form', 'input', 'textarea', 'text'];
    static emits = ['input', 'change'];
    static optionValues = { variant: ['default', ...TONES, 'secondary', 'error'], size: ['xs', 'sm', 'md', 'lg', 'xl'], resize: ['none', 'vertical', 'horizontal', 'both'], disabled: 'boolean' };
    static dependencies = [];
    
    static create(container, options = {}) {
        const id = options.id || _newTextareaId();
        const instance = new Textarea(id, options);
        if (container && container instanceof HTMLElement) {
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    static stories() {
        return {
            'Default': { label: 'Commit notes', placeholder: 'Describe what changed', rows: 3 },
            'Filled': { label: 'Scene description', value: 'A coastal village at dusk with fog over the water.', rows: 3 }
        };
    }
    
    constructor(id = _newTextareaId(), options = {}) {
        super(id, 'textarea');
        // A composite widget: render a <div>, not the native <textarea> element
        this.tag = 'div';
        
        // Textarea-specific properties
        this.value = options.value || '';
        this.placeholder = options.placeholder || '';
        this.disabled = options.disabled || false;
        this.required = options.required || false;
        this.readonly = options.readonly || false;
        this.variant = options.variant || 'default'; // default, primary, secondary, success, warning, error
        this.size = options.size || 'md'; // xs, sm, md, lg, xl
        this.rows = options.rows || 4;
        this.maxRows = options.maxRows || null;
        this.minRows = options.minRows || 1;
        this.resize = options.resize || 'vertical'; // none, vertical, horizontal, both
        this.maxLength = options.maxLength || null;
        this.minLength = options.minLength || null;
        this.label = options.label || '';
        this.description = options.description || '';
        this.name = options.name || '';
        this.error = options.error || '';
        
        // State management
        this.isFocused = false;
        this.characterCount = 0;
        
        // Accessibility lives on the inner <textarea> (id `${id}-input`), the one
        // textbox; it states disabled, required, read-only and multi-line natively
        this.fieldLabel = this.label || options.ariaLabel || '';
        this.fieldDescribedBy = this.description ? `${id}-description` : null;

        // Set default styles
        this.setupStyles();
        
        // Setup event handlers
        this.setupEventHandlers();
        
        // Build textarea structure
        this.buildTextarea();
    }
    
    setupStyles() {
        const sizeStyles = this.getSizeStyles();
        const variantStyles = this.getVariantStyles();
        
        this.setStyles({
            display: 'flex',
            width: '100%',
            flexDirection: 'column',
            gap: tokens.css('spacing.xs'),
            position: 'relative',
            outline: 'none',
            ...sizeStyles,
            ...variantStyles
        });
    }
    
    getSizeStyles() {
        const sizes = {
            xs: {
                fontSize: tokens.css('fontSizes.xs'),
                minHeight: '80px'
            },
            sm: {
                fontSize: tokens.css('fontSizes.sm'),
                minHeight: '96px'
            },
            md: {
                fontSize: tokens.css('fontSizes.md'),
                minHeight: '112px'
            },
            lg: {
                fontSize: tokens.css('fontSizes.lg'),
                minHeight: '128px'
            },
            xl: {
                fontSize: tokens.css('fontSizes.xl'),
                minHeight: '144px'
            }
        };
        return sizes[this.size] || sizes.md;
    }
    
    getVariantStyles() {
        // variant names the tone of the focus ring; a named tone also tints the label
        return { color: this.variant === 'default' ? 'var(--text-primary, #e4e4e7)' : toneOf(this.variant).text };
    }

    /** Field colours for the current focus, error and disabled state. */
    fieldColors() {
        return fieldStyles(this.variant, { focused: this.isFocused, invalid: Boolean(this.error), disabled: this.disabled });
    }
    
    setupEventHandlers() {
        if (!this.disabled && !this.readonly) {
            // Native input/change are heard on the inner <textarea> (see
            // buildTextarea); the widget's own input/change events, declared
            // in `emits`, are the only ones outside listeners on it receive.
            this.onFieldInput = (e) => {
                this.setValue(e.domTarget.value);
                this.updateCharacterCount();
                
                this.dispatchEvent({
                    type: 'input',
                    bubbles: true,
                    detail: {
                        value: this.value,
                        characterCount: this.characterCount
                    }
                });
            };

            this.onFieldChange = () => {
                this.dispatchEvent({
                    type: 'change',
                    bubbles: true,
                    detail: {
                        value: this.value,
                        characterCount: this.characterCount
                    }
                });
            };

            this.addEventListener('focus', () => {
                this.isFocused = true;
                this.setState(NODE_STATE.FOCUSED, true);
                this.updateVisualState();
                this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
            });
            
            this.addEventListener('blur', () => {
                this.isFocused = false;
                this.setState(NODE_STATE.FOCUSED, false);
                this.updateVisualState();
                this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
            });
        }
    }
    
    buildTextarea() {
        this.clearChildren();
        
        // Create textarea container
        const container = new UINode(`${this.id}-container`, 'div');
        container.setStyles({
            position: 'relative',
            width: '100%'
        });
        
        // Create textarea
        const textarea = new UINode(`${this.id}-input`, 'textarea');
        textarea.name = this.name;
        textarea.value = this.value;
        textarea.placeholder = this.placeholder;
        textarea.disabled = this.disabled;
        textarea.readOnly = this.readonly;
        textarea.required = this.required;
        textarea.rows = this.rows;
        textarea.ariaLabel = this.fieldLabel || null;
        textarea.ariaDescribedBy = this.fieldDescribedBy;

        if (this.maxLength) {
            textarea.maxLength = this.maxLength;
        }
        
        if (this.minLength) {
            textarea.minLength = this.minLength;
        }
        
        // Textarea styles
        textarea.setStyles({
            width: '100%',
            minHeight: this.getMinHeight(),
            maxHeight: this.maxRows ? (this.getRowHeight() * this.maxRows + 'px') : 'none',
            padding: '12px 14px',
            backgroundColor: this.getBackgroundColor(),
            color: this.getTextColor(),
            border: '1px solid ' + this.getBorderColor(),
            borderRadius: '14px',
            fontSize: '14px',
            fontFamily: 'inherit',
            fontWeight: '400',
            lineHeight: '1.5',
            resize: this.getResizeStyle(),
            outline: 'none',
            transition: 'border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease, background-color 160ms ease',
            boxShadow: this.fieldColors().boxShadow
        });
        
        if (this.onFieldInput) {
            textarea.addEventListener('input', this.onFieldInput);
            textarea.addEventListener('change', this.onFieldChange);
        }

        // Add textarea to container
        container.appendChild(textarea);
        
        // Character count if maxLength is set
        if (this.maxLength) {
            const characterCount = new UINode(`${this.id}-count`, 'span');
            characterCount.textContent = `${this.characterCount}/${this.maxLength}`;
            characterCount.setStyles({
                position: 'absolute',
                right: tokens.css('spacing.sm'),
                bottom: tokens.css('spacing.sm'),
                fontSize: '11px',
                color: this.characterCount > this.maxLength * 0.9 ? toneOf('danger').text : 'var(--text-secondary, #475569)',
                backgroundColor: 'var(--surface-raised, #171723)',
                padding: '3px 6px',
                borderRadius: '999px',
                pointerEvents: 'none',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.12)'
            });
            
            container.appendChild(characterCount);
            this.characterCountElement = characterCount;
        }
        
        // Error message if present
        if (this.error) {
            const errorMessage = new UINode(`${this.id}-error`, 'span');
            errorMessage.textContent = this.error;
            errorMessage.setStyles({
                fontSize: '12px',
                color: toneOf('danger').text,
                marginTop: tokens.css('spacing.xs')
            });
            
            container.appendChild(errorMessage);
        }
        
        this.appendChild(container);
        this.textarea = textarea;
        
        // Update initial state
        this.updateCharacterCount();
        this.updateVisualState();
    }
    
    getMinHeight() {
        return this.getRowHeight() * this.minRows + 'px';
    }
    
    getRowHeight() {
        const fontSize = this.getFontSize();
        return Math.floor(fontSize * 1.5); // Approximate line height
    }
    
    getFontSize() {
        const sizes = {
            xs: 12,
            sm: 14,
            md: 16,
            lg: 18,
            xl: 20
        };
        return sizes[this.size] || sizes.md;
    }
    
    getBackgroundColor() {
        return this.fieldColors().backgroundColor;
    }
    
    getTextColor() {
        if (this.disabled) {
            return 'var(--text-disabled, #94a3b8)';
        }
        return 'var(--text-primary, #0f172a)';
    }
    
    getBorderColor() {
        return this.fieldColors().borderColor;
    }
    
    getResizeStyle() {
        const resizeStyles = {
            none: 'none',
            vertical: 'vertical',
            horizontal: 'horizontal',
            both: 'both'
        };
        return resizeStyles[this.resize] || resizeStyles.vertical;
    }
    
    updateCharacterCount() {
        this.characterCount = this.value.length;
        
        if (this.characterCountElement) {
            this.characterCountElement.textContent = `${this.characterCount}/${this.maxLength}`;
            this.characterCountElement.setStyle('color', 
                this.characterCount > this.maxLength * 0.9 ? toneOf('danger').text : tokens.css('colors.text.secondary')
            );
        }
    }
    
    updateVisualState() {
        if (this.textarea) {
            const focusShadow = this.fieldColors().boxShadow;
            const inputTransform = this.isFocused ? 'translateY(-1px)' : 'translateY(0)';
            this.textarea.setStyle('borderColor', this.getBorderColor());
            this.textarea.setStyle('backgroundColor', this.getBackgroundColor());
            this.textarea.setStyle('color', this.getTextColor());
            this.textarea.setStyle('boxShadow', focusShadow);
            this.textarea.setStyle('transform', inputTransform);
        }
    }
    
    // Public methods
    setValue(value) {
        if (this.value !== value) {
            this.value = value;
            
            // Enforce maxLength if set
            if (this.maxLength && value.length > this.maxLength) {
                this.value = value.substring(0, this.maxLength);
            }
            
            // Enforce minLength if set
            if (this.minLength && this.value.length < this.minLength) {
                // Don't enforce minLength on setValue, let validation handle it
            }
            
            if (this.textarea) {
                this.textarea.element.value = this.value;
            }
            
            this.updateCharacterCount();
            this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }
    
    setDisabled(disabled) {
        if (this.disabled !== disabled) {
            this.disabled = disabled;
            this.setState(NODE_STATE.DISABLED, disabled);
            this.setState(NODE_STATE.FOCUSABLE, !disabled);
            
            if (this.textarea) {
                this.textarea.element.disabled = disabled;
            }
            
            this.updateVisualState();
            this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }
    
    setReadOnly(readonly) {
        if (this.readonly !== readonly) {
            this.readonly = readonly;

            if (this.textarea) {
                this.textarea.element.readOnly = readonly;
            }
            
            this.updateVisualState();
            this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }
    
    setRequired(required) {
        if (this.required !== required) {
            this.required = required;

            if (this.textarea) {
                this.textarea.element.required = required;
            }
            
            this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }
    
    setVariant(variant) {
        if (this.variant !== variant) {
            this.variant = variant;
            this.setupStyles();
            this.updateVisualState();
            this.markDirty(DIRTY.STYLE | DIRTY.PAINT);
        }
    }
    
    setSize(size) {
        if (this.size !== size) {
            this.size = size;
            this.setupStyles();
            this.buildTextarea();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setPlaceholder(placeholder) {
        if (this.placeholder !== placeholder) {
            this.placeholder = placeholder;
            
            if (this.textarea) {
                this.textarea.element.placeholder = placeholder;
            }
            
            this.markDirty(DIRTY.PAINT);
        }
    }
    
    setRows(rows) {
        if (this.rows !== rows) {
            this.rows = rows;
            
            if (this.textarea) {
                this.textarea.element.rows = rows;
            }
            
            this.markDirty(DIRTY.PAINT | DIRTY.LAYOUT);
        }
    }
    
    setMaxRows(maxRows) {
        if (this.maxRows !== maxRows) {
            this.maxRows = maxRows;
            this.buildTextarea();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setMinRows(minRows) {
        if (this.minRows !== minRows) {
            this.minRows = minRows;
            this.buildTextarea();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setResize(resize) {
        if (this.resize !== resize) {
            this.resize = resize;
            
            if (this.textarea) {
                this.textarea.setStyle('resize', this.getResizeStyle());
            }
            
            this.markDirty(DIRTY.PAINT);
        }
    }
    
    setMaxLength(maxLength) {
        if (this.maxLength !== maxLength) {
            this.maxLength = maxLength;
            
            if (this.textarea) {
                if (maxLength) {
                    this.textarea.element.maxLength = maxLength;
                } else {
                    this.textarea.element.removeAttribute('maxLength');
                }
            }
            
            this.buildTextarea(); // Rebuild to add/remove character count
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }
    
    setMinLength(minLength) {
        if (this.minLength !== minLength) {
            this.minLength = minLength;
            
            if (this.textarea) {
                if (minLength) {
                    this.textarea.element.minLength = minLength;
                } else {
                    this.textarea.element.removeAttribute('minLength');
                }
            }
            
            this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }
    
    setError(error) {
        if (this.error !== error) {
            this.error = error;
            this.buildTextarea();
            this.updateVisualState();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setLabel(label) {
        if (this.label !== label) {
            this.label = label;
            this.fieldLabel = label;
            if (this.textarea) {
                this.textarea.ariaLabel = label || null;
                this.textarea.markDirty(DIRTY.ACCESSIBILITY);
            }
        }
    }

    setDescription(description) {
        if (this.description !== description) {
            this.description = description;
            this.fieldDescribedBy = description ? (this.id + '-description') : null;
            if (this.textarea) {
                this.textarea.ariaDescribedBy = this.fieldDescribedBy;
                this.textarea.markDirty(DIRTY.ACCESSIBILITY);
            }
        }
    }
    
    setValue(value) {
        if (this.value !== value) {
            this.value = value;
            
            // Enforce maxLength if set
            if (this.maxLength && value.length > this.maxLength) {
                this.value = value.substring(0, this.maxLength);
            }
            
            if (this.textarea) {
                this.textarea.element.value = this.value;
            }
            
            this.updateCharacterCount();
            this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }
    
    setName(name) {
        if (this.name !== name) {
            this.name = name;
            
            if (this.textarea) {
                this.textarea.element.name = name;
            }
            
            this.markDirty(DIRTY.PAINT);
        }
    }
    
    // Static factory methods
    static getDefaultOptions() {
        return {
            value: '',
            placeholder: '',
            disabled: false,
            variant: 'default',
            size: 'md'
        };
    }
    
    static createTextarea(id, options = {}) {
        return new Textarea(id, options);
    }
    
    static createPrimaryTextarea(id, options = {}) {
        return new Textarea(id, { variant: 'primary', ...options });
    }
    
    static createSuccessTextarea(id, options = {}) {
        return new Textarea(id, { variant: 'success', ...options });
    }
    
    static createWarningTextarea(id, options = {}) {
        return new Textarea(id, { variant: 'warning', ...options });
    }
    
    static createErrorTextarea(id, options = {}) {
        return new Textarea(id, { variant: 'error', ...options });
    }
    
    static createSmallTextarea(id, options = {}) {
        return new Textarea(id, { size: 'sm', ...options });
    }
    
    static createLargeTextarea(id, options = {}) {
        return new Textarea(id, { size: 'lg', ...options });
    }
    
    static createXLargeTextarea(id, options = {}) {
        return new Textarea(id, { size: 'xl', ...options });
    }
    
    static createLimitedTextarea(id, maxLength, options = {}) {
        return new Textarea(id, { maxLength, showCharacterCount: true, ...options });
    }
    
    static createResizableTextarea(id, options = {}) {
        return new Textarea(id, { resize: 'both', ...options });
    }
    
    static createFixedTextarea(id, options = {}) {
        return new Textarea(id, { resize: 'none', ...options });
    }
}
