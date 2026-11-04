// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Chip/Tag - Removable tag widget for Plauna
 * Provides chip functionality with multiple variants and states
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { tone as toneOf, mix, TONES } from '../shared/appearance.js';

let _chipSequence = 0;

function _newChipId() {
    return `chip-${Date.now()}-${++_chipSequence}`;
}

export class Chip extends UINode {
    // Widget metadata
    static id = 'chip';
    static name = 'Chip';
    static category = 'primitive';
    static icon = '🏷️';
    static description = 'Chip/tag element';
    static tags = ['primitive', 'chip', 'tag'];
    static emits = ['click'];
    static dependencies = [];
    static optionValues = { variant: ['default', ...TONES, 'error'], appearance: ['soft', 'solid', 'outline'], removable: 'boolean', disabled: 'boolean' };
    
    static getDefaultOptions() {
        return {
            label: '',
            variant: 'default',
            removable: false
        };
    }

    static stories() {
        return {
            'Default':   { label: 'Design' },
            'Primary':   { label: 'Primary',  variant: 'primary' },
            'Removable': { label: 'Remove me', removable: true },
            'Success':   { label: 'Approved', variant: 'success' },
            'Warning':   { label: 'Review',   variant: 'warning' },
            'Solid accent': { label: 'Featured', variant: 'accent', appearance: 'solid' },
            'Outline info': { label: 'WebGPU', variant: 'info', appearance: 'outline', removable: true },
        };
    }
    
    static create(container, options = {}) {
        const instance = new Chip(_newChipId(), options);
        if (container && container instanceof HTMLElement) {
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newChipId(), options = {}) {
        super(id, 'chip');
        
        // Chip-specific properties
        this.label = options.label || '';
        this.appearance = options.appearance || 'soft'; // soft, solid, outline
        this.value = options.value || '';
        this.variant = options.variant || 'default'; // default, primary, secondary, success, warning, error
        this.size = options.size || 'md'; // xs, sm, md, lg, xl
        this.disabled = options.disabled || false;
        this.removable = options.removable === true;
        this.avatar = options.avatar || null;
        this.icon = options.icon || null;
        this.onClick = options.onClick || null;
        this.onRemove = options.onRemove || null;
        
        // State management
        this.isHovered = false;

        // The pill is a part that draws the chip and hears native clicks. The
        // root dispatches only its own click (`emits`), so a click listener on
        // the chip gets that one event and handleClick never re-enters itself.
        this.pill = new UINode(`${id}-pill`, 'div');
        this.appendChild(this.pill);

        // Set accessibility on the pill, the element that is clicked
        this.pill.role = 'button';
        this.pill.ariaDisabled = this.disabled;
        this.pill.ariaLabel = this.label || options.ariaLabel || '';
        this.pill.ariaDescribedBy = this.removable ? `${id}-remove-button` : null;
        // Mark chip as keyboard-focusable when not disabled
        this.setState(NODE_STATE.FOCUSABLE, !this.disabled);
        
        /**
         * Setup modern chip/pill styling.
         *
         * Modern design pattern: soft, elevated pill with clear borders.
         * - Full rounded corners (border-radius-full) for pill shape
         * - Subtle shadow adds depth without heaviness
         * - Backdrop filter creates glassy layered effect
         * - Minimum 32px height for better touch targets
         * - Tinted backgrounds with stronger borders for variant differentiation
         *
         * Variants use alpha-transparent backgrounds rather than solid colors,
         * allowing them to work across light/dark themes while maintaining
         * semantic meaning (primary, success, warning, error).
         */
        // Set default styles
        this.setupStyles();
        
        // Setup event handlers
        this.setupEventHandlers();
        
        // Build chip structure
        this.buildChip();
    }
    
    setupStyles() {
        const sizeStyles = this.getSizeStyles();
        const variantStyles = this.getVariantStyles();

        // The root only places the chip; the pill fills it exactly
        this.setStyles({
            display: 'inline-flex',
            alignSelf: 'flex-start',
            width: 'fit-content',
            maxWidth: '100%'
        });

        this.pill.setStyles({
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--spacing-xs)',
            padding: this.getPadding(),
            backgroundColor: this.getBackgroundColor(),
            color: this.getTextColor(),
            border: '1px solid ' + this.getBorderColor(),
            borderRadius: 'var(--border-radius-full)',
            fontSize: 'inherit',
            fontWeight: '600',
            lineHeight: 1,
            cursor: this.disabled ? 'not-allowed' : 'pointer',
            outline: 'none',
            boxShadow: 'none',
            transition: 'transform 150ms ease, box-shadow 150ms ease, background-color 150ms ease, color 150ms ease, border-color 150ms ease, opacity 150ms ease',
            position: 'relative',
            // Shrinks with the root, so a long label still ends in an ellipsis
            minWidth: '0',
            whiteSpace: 'nowrap',
            minHeight: '32px',
            ...sizeStyles,
            ...variantStyles
        });
    }
    
    getSizeStyles() {
        const sizes = {
            xs: {
                padding: '2px 8px',
                fontSize: 'var(--font-size-xs)'
            },
            sm: {
                padding: '4px 10px',
                fontSize: 'var(--font-size-sm)'
            },
            md: {
                padding: '5px 12px',
                fontSize: 'var(--font-size-md)'
            },
            lg: {
                padding: '6px 14px',
                fontSize: 'var(--font-size-lg)'
            },
            xl: {
                padding: '8px 16px',
                fontSize: 'var(--font-size-xl)'
            }
        };
        return sizes[this.size] || sizes.md;
    }
    
    getPadding() {
        const sizes = {
            xs: '2px 8px',
            sm: '4px 10px',
            md: '5px 12px',
            lg: '6px 14px',
            xl: '8px 16px'
        };
        return sizes[this.size] || sizes.md;
    }
    
    /**
     * Get variant-specific styles with alpha-transparent colors.
     *
     * Modern alpha-transparent variant pattern:
     * - Uses RGBA colors with low opacity for backgrounds
     * - Stronger opacity for borders for definition
     * - Works across both light and dark themes without theme-specific values
     * - Semantic colors: primary, secondary, success, warning, error
     *
     * Alpha transparency allows chips to work as overlays on any background
     * while maintaining semantic meaning through color hue.
     */
    getVariantStyles() {
        // variant names the tone (default is neutral); appearance picks soft, solid or outline
        const c = toneOf(this.variant === 'default' ? 'neutral' : this.variant);
        if (this.disabled) {
            return { backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-disabled)', borderColor: 'var(--border-light)' };
        }
        if (this.appearance === 'solid') return { backgroundColor: c.base, color: c.on, borderColor: 'transparent' };
        if (this.appearance === 'outline') return { backgroundColor: 'transparent', color: c.text, borderColor: c.border };
        return { backgroundColor: c.soft, color: c.text, borderColor: c.subtleBorder };
    }

    setAppearance(appearance) {
        this.appearance = appearance || 'soft';
        this.pill.setStyles(this.getVariantStyles());
    }

    /** Background colour: the tone style for the current variant, appearance and state. */
    getBackgroundColor() {
        return this.getVariantStyles().backgroundColor;
    }
    
    /** Text colour: the tone style for the current variant, appearance and state. */
    getTextColor() {
        return this.getVariantStyles().color;
    }
    
    /** Border colour: the tone style for the current variant, appearance and state. */
    getBorderColor() {
        return this.getVariantStyles().borderColor;
    }
    
    setupEventHandlers() {
        if (!this.disabled) {
            // Native events are heard on the pill. Clicks and keys from the
            // remove button are its own (handleRemove), not a chip click.
            this.pill.addEventListener('click', (e) => {
                if (this.isFromRemoveButton(e)) return;
                this.handleClick(e);
            });

            this.pill.addEventListener('mouseenter', () => {
                this.isHovered = true;
                this.setState(NODE_STATE.HOVER, true);
                this.updateVisualState();
                this.markDirty(DIRTY.PAINT);
            });

            this.pill.addEventListener('mouseleave', () => {
                this.isHovered = false;
                this.setState(NODE_STATE.HOVER, false);
                this.updateVisualState();
                this.markDirty(DIRTY.PAINT);
            });

            this.pill.addEventListener('keydown', (e) => {
                if (this.isFromRemoveButton(e)) return;
                if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    this.handleClick(e);
                }
            });

            /**
             * Modern focus treatment for chips.
             *
             * Chips are keyboard-focusable with a clear focus ring:
             * - Outline ring with primary color for visibility
             * - Outline offset provides spacing from chip border
             * - Dual-layer shadow (outer ring + base shadow) for depth
             *
             * This ensures keyboard navigation is discoverable and visible,
             * following WCAG 2.1 guidelines for focus indicators.
             */
            this.pill.addEventListener('focus', () => {
                this.setState(NODE_STATE.FOCUSED, true);
                this.pill.setStyle('outline', `2px solid ${toneOf('primary').subtleBorder}`);
                this.pill.setStyle('outlineOffset', '2px');
                this.pill.setStyle('boxShadow', `0 0 0 3px ${mix(toneOf('primary').base, 10)}, var(--shadow-sm)`);
            });

            /**
             * Restore chip appearance on blur.
             *
             * Removes focus ring and restores base shadow via
             * updateVisualState to maintain consistent idle appearance.
             */
            this.pill.addEventListener('blur', () => {
                this.setState(NODE_STATE.FOCUSED, false);
                this.pill.setStyle('outline', 'none');
                this.pill.setStyle('outlineOffset', '0');
                this.updateVisualState();
            });
        }
    }

    /** Whether a native event on the pill started at the remove button. */
    isFromRemoveButton(e) {
        const remove = this.removeButton?.element;
        return Boolean(remove && e.domTarget && remove.contains(e.domTarget));
    }
    
    /**
     * Build the chip's flexible DOM structure.
     *
     * Flexible chip structure pattern:
     * 1. Container: the pill part, with pill styling and event handlers
     *    (the root around it only places the chip)
     * 2. Avatar (optional): Small user avatar on the left
     * 3. Icon (optional): Icon on the left if no avatar
     * 4. Label: Text content in the center
     * 5. Remove button (optional): Dismissible action on the right
     *
     * This structure supports various chip types:
     * - Simple text chips (label only)
     * - Avatar chips (avatar + label)
     * - Icon chips (icon + label)
     * - Removable chips (label + remove button)
     * - Combined chips (avatar + label + remove button)
     */
    buildChip() {
        this.pill.clearChildren();
        this.removeButton = null;

        // Add avatar if present
        if (this.avatar) {
            const avatar = this.createAvatar();
            this.pill.appendChild(avatar);
        }

        // Add icon if present
        if (this.icon) {
            const icon = this.createIcon();
            this.pill.appendChild(icon);
        }
        
        // Add label
        const label = new UINode(`${this.id}-label`, 'span');
        label.textContent = this.label;
        label.setStyles({
            flex: '0 1 auto',
            color: 'inherit',
            fontWeight: 'inherit',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
        });
        this.pill.appendChild(label);

        // Add remove button if removable
        if (this.removable) {
            const removeButton = this.createRemoveButton();
            this.pill.appendChild(removeButton);
            this.removeButton = removeButton;
        }
        
        this.updateVisualState();
    }
    
    /**
     * Create avatar sub-component for chip.
     *
     * Sub-component pattern:
     * - Creates UINode for avatar with appropriate styling
     * - Uses size-based dimensions that scale with chip size
     * - Circular border-radius for consistent profile appearance
     * - Object-fit cover for proper image scaling
     */
    createAvatar() {
        const avatar = new UINode(`${this.id}-avatar`, 'img');
        avatar.src = this.avatar.src;
        avatar.alt = this.avatar.alt || '';
        avatar.setStyles({
            width: this.getAvatarSize() + 'px',
            height: this.getAvatarSize() + 'px',
            borderRadius: '50%',
            objectFit: 'cover',
            flexShrink: '0'
        });
        return avatar;
    }
    
    getAvatarSize() {
        const sizes = {
            xs: 16,
            sm: 20,
            md: 24,
            lg: 28,
            xl: 32
        };
        return sizes[this.size] || sizes.md;
    }
    
    /**
     * Create icon sub-component for chip.
     *
     * Sub-component pattern:
     * - Creates UINode for icon with text content
     * - Inherits font size from parent for consistent scaling
     * - Flex layout for proper alignment with label
     */
    createIcon() {
        const icon = new UINode(`${this.id}-icon`, 'span');
        icon.textContent = this.icon;
        icon.setStyles({
            width: '16px',
            height: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 'var(--font-size-sm)',
            color: 'inherit',
            flexShrink: '0'
        });
        return icon;
    }

    /**
     * Create remove button sub-component for chip.
     *
     * Sub-component pattern:
     * - Creates UINode for dismissible action button
     * - Uses × (multiplication sign) as universal close icon
     * - Sets up click handler to trigger onRemove callback
     * - Dispatches 'remove' event for parent component handling
     */
    createRemoveButton() {
        const removeButton = new UINode(`${this.id}-remove`, 'button');
        removeButton.type = 'button';
        removeButton.ariaLabel = 'Remove';
        removeButton.textContent = '×';
        removeButton.setStyles({
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '16px',
            height: '16px',
            borderRadius: '50%',
            backgroundColor: mix('var(--text-tertiary, #9ca3af)', 14),
            color: 'inherit',
            border: 'none',
            cursor: 'pointer',
            fontSize: '12px',
            lineHeight: 1,
            opacity: 0.9
        });
        removeButton.addEventListener('click', (e) => {
            if (!this.disabled) this.handleRemove(e);
        });
        return removeButton;
    }

    setOnClick(onClick) {
        this.onClick = onClick;
    }

    setOnRemove(onRemove) {
        this.onRemove = onRemove;
    }

    // Static factory methods
    static createChip(id, options = {}) {
        return new Chip(id, options);
    }

    static createPrimaryChip(id, options = {}) {
        return new Chip(id, { variant: 'primary', ...options });
    }

    static createSuccessChip(id, options = {}) {
        return new Chip(id, { variant: 'success', ...options });
    }

    static createWarningChip(id, options = {}) {
        return new Chip(id, { variant: 'warning', ...options });
    }

    static createErrorChip(id, options = {}) {
        return new Chip(id, { variant: 'error', ...options });
    }

    static createSmallChip(id, options = {}) {
        return new Chip(id, { size: 'sm', ...options });
    }

    static createLargeChip(id, options = {}) {
        return new Chip(id, { size: 'lg', ...options });
    }

    static createXLargeChip(id, options = {}) {
        return new Chip(id, { size: 'xl', ...options });
    }

    handleClick(e) {
        if (this.onClick && typeof this.onClick === 'function') {
            this.onClick({
                label: this.label,
                value: this.value,
                variant: this.variant,
                disabled: this.disabled
            });
        }

        this.dispatchEvent({
            type: 'click',
            bubbles: true,
            detail: {
                label: this.label,
                value: this.value,
                variant: this.variant
            }
        });
    }

    handleRemove(e) {
        if (this.onRemove && typeof this.onRemove === 'function') {
            this.onRemove({
                label: this.label,
                value: this.value,
                variant: this.variant
            });
        }

        this.dispatchEvent({
            type: 'remove',
            bubbles: true,
            detail: {
                label: this.label,
                value: this.value,
                variant: this.variant
            }
        });
    }

    /**
     * Update visual state based on hover and disabled conditions.
     *
     * Modern interaction pattern:
     * - Hover: subtle lift (translateY) and elevated shadow for tactile feedback
     * - Idle: maintains base shadow (var(--shadow-sm)) for modern surface appearance
     * - Disabled: reduced opacity and not-allowed cursor
     *
     * The base shadow is preserved when not hovered to maintain the
     * modern pill surface treatment across interaction states.
     */
    updateVisualState() {
        // Update hover state
        if (this.isHovered && !this.disabled) {
            this.pill.setStyle('transform', 'translateY(-1px)');
            this.pill.setStyle('boxShadow', '0 4px 12px rgba(0, 0, 0, 0.15)');
        } else {
            this.pill.setStyle('transform', 'translateY(0)');
            this.pill.setStyle('boxShadow', 'var(--shadow-sm)');
        }

        // Update disabled state
        if (this.disabled) {
            this.pill.setStyle('opacity', '0.5');
            this.pill.setStyle('cursor', 'not-allowed');
        } else {
            this.pill.setStyle('opacity', '1');
            this.pill.setStyle('cursor', 'pointer');
        }
    }

    // Public methods
    setLabel(label) {
        if (this.label !== label) {
            this.label = label;
            this.pill.ariaLabel = label;
            this.pill.markDirty(DIRTY.ACCESSIBILITY);
            const labelElement = this.querySelector(`#${this.id}-label`);
            if (labelElement) {
                labelElement.setTextContent(label);
            }
            this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }

    setValue(value) {
        if (this.value !== value) {
            this.value = value;
            this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }

    setVariant(variant) {
        if (this.variant !== variant) {
            this.variant = variant;
            this.setupStyles();
            this.markDirty(DIRTY.STYLE | DIRTY.PAINT);
        }
    }

    setSize(size) {
        if (this.size !== size) {
            this.size = size;
            this.setupStyles();
            this.buildChip();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }

    setDisabled(disabled) {
        if (this.disabled !== disabled) {
            this.disabled = disabled;
            this.pill.ariaDisabled = disabled;
            this.pill.markDirty(DIRTY.ACCESSIBILITY);
            this.setState(NODE_STATE.DISABLED, disabled);
            this.setState(NODE_STATE.FOCUSABLE, !disabled);
            this.updateVisualState();
            this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }

    setRemovable(removable) {
        if (this.removable !== removable) {
            this.removable = removable;
            this.buildChip();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }

    setAvatar(avatar) {
        if (this.avatar !== avatar) {
            this.avatar = avatar;
            this.buildChip();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }

    setIcon(icon) {
        if (this.icon !== icon) {
            this.icon = icon;
            this.buildChip();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
}
