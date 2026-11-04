// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Rating - Star rating widget for Plauna
 * Provides rating functionality with multiple states and variants
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { tone as toneOf, TONES } from '../shared/appearance.js';

let _ratingSequence = 0;

function _newRatingId() {
    return `rating-${Date.now()}-${++_ratingSequence}`;
}

export class Rating extends UINode {
    // Widget metadata
    static id = 'rating';
    static name = 'Rating';
    static category = 'form';
    static icon = '⭐';
    static description = 'Star rating form control';
    static tags = ['form', 'input', 'rating', 'stars', 'control'];
    static emits = ['input', 'change'];
    static optionValues = { variant: ['default', ...TONES, 'secondary', 'error'], size: ['xs', 'sm', 'md', 'lg', 'xl'], disabled: 'boolean' };
    static dependencies = [];
    
    static stories() {
        return {
            'Default': { label: 'Asset quality', value: 3 },
            'Read only': { label: 'Average review', value: 4, readonly: true }
        };
    }
    
    constructor(id = _newRatingId(), options = {}) {
        super(id, 'rating');
        
        // Rating-specific properties
        this.value = options.value || 0;
        this.max = options.max || 5;
        this.disabled = options.disabled || false;
        this.required = options.required || false;
        this.variant = options.variant || 'default'; // default, primary, secondary, success, warning, error
        this.size = options.size || 'md'; // xs, sm, md, lg, xl
        this.readonly = options.readonly || false;
        this.halfPrecision = options.halfPrecision || false;
        this.showValue = options.showValue !== false;
        this.label = options.label || '';
        this.description = options.description || '';
        this.name = options.name || '';
        this.error = options.error || '';
        
        // State management
        this.isFocused = false;
        this.hoverValue = 0;
        
        // Set accessibility
        this.role = 'slider';
        this.ariaDisabled = this.disabled;
        this.ariaRequired = this.required;
        this.ariaLabel = this.label || options.ariaLabel || '';
        this.ariaDescribedBy = this.description ? `${id}-description` : null;
        this.ariaValueMin = '0';
        this.ariaValueMax = this.max.toString();
        this.ariaValueNow = this.value.toString();
        this.ariaValueText = `${this.value} of ${this.max}`;
        this.ariaOrientation = 'horizontal';
        // The slider itself takes focus; arrow keys change the value
        this.tabIndex = this.disabled ? null : '0';
        
        // Set default styles
        this.setupStyles();
        
        // Setup event handlers
        this.setupEventHandlers();
        
        // Build rating structure
        this.buildRating();
    }
    
    setupStyles() {
        const sizeStyles = this.getSizeStyles();
        const variantStyles = this.getVariantStyles();
        
        this.setStyles({
            display: 'inline-flex',
            flexDirection: 'row',
            alignItems: 'center',
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
                fontSize: tokens.css('fontSizes.xs')
            },
            sm: {
                fontSize: tokens.css('fontSizes.sm')
            },
            md: {
                fontSize: tokens.css('fontSizes.md')
            },
            lg: {
                fontSize: tokens.css('fontSizes.lg')
            },
            xl: {
                fontSize: tokens.css('fontSizes.xl')
            }
        };
        return sizes[this.size] || sizes.md;
    }
    
    getVariantStyles() {
        return { color: this.toneColors().base };
    }

    /** The stars' tone: default is warning (gold), secondary is neutral, error is danger. */
    toneColors() {
        return toneOf(this.variant === 'default' ? 'warning' : this.variant);
    }
    
    setupEventHandlers() {
        if (!this.disabled && !this.readonly) {
            this.addEventListener('keydown', (e) => {
                switch (e.key) {
                    case 'ArrowLeft':
                    case 'ArrowDown':
                        e.preventDefault();
                        this.adjustValue(-1);
                        break;
                    case 'ArrowRight':
                    case 'ArrowUp':
                        e.preventDefault();
                        this.adjustValue(1);
                        break;
                    case 'Home':
                        e.preventDefault();
                        this.setValue(0);
                        break;
                    case 'End':
                        e.preventDefault();
                        this.setValue(this.max);
                        break;
                }
            });
            
            this.addEventListener('focus', () => {
                this.isFocused = true;
                this.setState(NODE_STATE.FOCUSED, true);
                this.updateVisualState();
                this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
            });
            
            this.addEventListener('blur', () => {
                this.isFocused = false;
                this.setState(NODE_STATE.FOCUSED, false);
                this.hoverValue = 0;
                this.updateVisualState();
                this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
            });
        }
    }
    
    buildRating() {
        this.clearChildren();
        
        // Create stars container
        const starsContainer = new UINode(`${this.id}-stars`, 'div');
        starsContainer.setStyles({
            display: 'flex',
            flexDirection: 'row',
            gap: tokens.css('spacing.xs'),
            alignItems: 'center'
        });
        
        // Create individual stars
        for (let i = 0; i < this.max; i++) {
            const star = this.createStar(i);
            starsContainer.appendChild(star);
        }
        
        // Create value display if enabled
        if (this.showValue) {
            const valueDisplay = new UINode(`${this.id}-value`, 'span');
            valueDisplay.textContent = `${this.value}/${this.max}`;
            valueDisplay.setStyles({
                fontSize: tokens.css('fontSizes.sm'),
                fontWeight: tokens.css('fontWeights.medium'),
                color: tokens.css('colors.text.primary'),
                backgroundColor: tokens.css('colors.background.primary'),
                padding: '2px 6px',
                borderRadius: tokens.css('borderRadius.sm'),
                border: '1px solid ' + tokens.css('colors.border.medium'),
                marginLeft: tokens.css('spacing.sm')
            });
            
            this.appendChild(valueDisplay);
        }
        
        this.appendChild(starsContainer);
        this.starsContainer = starsContainer;
        this.updateVisualState();
    }
    
    createStar(index) {
        // Stars are pointer targets; keyboard users use the slider's arrow keys
        const star = new UINode(`${this.id}-star-${index}`, 'button');
        star.userData.type = 'button';
        star.tabIndex = '-1';
        star.ariaHidden = 'true';
        
        // Star styles
        const starSize = this.getStarSize();
        star.setStyles({
            appearance: 'none',
            width: starSize,
            height: starSize,
            backgroundColor: 'transparent',
            border: 'none',
            cursor: this.disabled || this.readonly ? 'not-allowed' : 'pointer',
            padding: '0',
            margin: '0',
            position: 'relative',
            outline: 'none',
            transition: 'all 150ms ease'
        });
        
        // Create star SVG as UINode
        const svg = new UINode(`${this.id}-star-${index}-svg`, 'svg');
        svg.userData.viewBox = '0 0 24 24';
        svg.userData.width = starSize;
        svg.userData.height = starSize;
        svg.setStyles({
            position: 'absolute',
            top: '0',
            left: '0',
            transition: 'all 150ms ease'
        });

        // Create path as UINode
        const path = new UINode(`${this.id}-star-${index}-path`, 'path');
        path.userData.d = 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.75L7 14.14 2 9.27l6.91-1.01L12 2z';
        path.setStyles({
            fill: this.getStarColor(index),
            stroke: this.getStarStrokeColor(index),
            strokeWidth: '2',
            transition: 'all 150ms ease'
        });

        svg.appendChild(path);
        star.appendChild(svg);
        
        // Event handlers
        if (!this.disabled && !this.readonly) {
            star.addEventListener('mouseenter', () => {
                this.hoverValue = index + 1;
                this.updateVisualState();
            });
            
            star.addEventListener('mouseleave', () => {
                this.hoverValue = 0;
                this.updateVisualState();
            });
            
            star.addEventListener('click', () => {
                this.setValue(index + 1);
                this.dispatchEvent({
                    type: 'change',
                    bubbles: true,
                    detail: { value: this.value }
                });
            });
            
            star.addEventListener('keydown', (e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    this.setValue(index + 1);
                    this.dispatchEvent({
                        type: 'change',
                        bubbles: true,
                        detail: { value: this.value }
                    });
                }
            });
        }
        
        return star;
    }
    
    getStarSize() {
        const sizes = {
            xs: '16px',
            sm: '20px',
            md: '24px',
            lg: '28px',
            xl: '32px'
        };
        return sizes[this.size] || sizes.md;
    }
    
    getStarColor(index) {
        const starValue = index + 1;
        const displayValue = this.hoverValue || this.value;
        
        if (starValue <= displayValue) {
            if (this.disabled) {
                return tokens.css('colors.text.disabled');
            }
            
            return this.toneColors().base;
        }
        
        return 'transparent';
    }
    
    getStarStrokeColor(index) {
        const starValue = index + 1;
        const displayValue = this.hoverValue || this.value;
        
        if (starValue <= displayValue) {
            if (this.disabled) {
                return tokens.css('colors.border.disabled');
            }
            
            return this.toneColors().base;
        }
        
        return tokens.css('colors.border.medium');
    }
    
    updateVisualState() {
        const stars = this.starsContainer?.children || [];
        const displayValue = this.hoverValue || this.value;

        for (let i = 0; i < stars.length; i++) {
            const star = stars[i];
            const svg = star.querySelector('svg');
            const path = svg ? svg.querySelector('path') : null;
            const isActive = (i + 1) <= displayValue;
            const activeTransform = isActive ? 'translateY(-1px) scale(1.05)' : 'translateY(0) scale(1)';

            if (path) {
                path.setStyle('fill', this.getStarColor(i));
                path.setStyle('stroke', this.getStarStrokeColor(i));
            }

            star.setStyle('transform', activeTransform);
            star.setStyle('filter', isActive ? 'drop-shadow(0 6px 10px rgba(0, 0, 0, 0.14))' : 'none');
        }

        // Update value display
        const valueDisplay = this.querySelector(`#${this.id}-value`);
        if (valueDisplay) {
            valueDisplay.textContent = `${this.value}/${this.max}`;
        }

        // Update ARIA
        this.ariaValueNow = this.value.toString();
    }
    
    adjustValue(delta) {
        const newValue = this.value + delta;
        this.setValue(Math.max(0, Math.min(this.max, newValue)));
        
        this.dispatchEvent({
            type: 'input',
            bubbles: true,
            detail: { value: this.value }
        });
    }
    
    // Public methods
    setValue(value) {
        if (this.value !== value) {
            this.value = Math.max(0, Math.min(this.max, value));
            this.ariaValueNow = String(this.value);
            this.ariaValueText = `${this.value} of ${this.max}`;
            this.updateVisualState();
            this.markDirty(DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }
    
    setMax(max) {
        if (this.max !== max) {
            this.max = max;
            this.ariaValueMax = max.toString();
            
            // Adjust value if necessary
            if (this.value > max) {
                this.setValue(max);
            }
            
            this.buildRating();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }
    
    setDisabled(disabled) {
        if (this.disabled !== disabled) {
            this.disabled = disabled;
            this.ariaDisabled = disabled;
            this.setState(NODE_STATE.DISABLED, disabled);
            this.setState(NODE_STATE.FOCUSABLE, !disabled);
            this.buildRating();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }
    
    setReadOnly(readonly) {
        if (this.readonly !== readonly) {
            this.readonly = readonly;
            this.buildRating();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setRequired(required) {
        if (this.required !== required) {
            this.required = required;
            this.ariaRequired = required;
            this.markDirty(DIRTY.ACCESSIBILITY);
        }
    }
    
    setVariant(variant) {
        if (this.variant !== variant) {
            this.variant = variant;
            this.setupStyles();
            this.buildRating();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setSize(size) {
        if (this.size !== size) {
            this.size = size;
            this.setupStyles();
            this.buildRating();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setShowValue(showValue) {
        if (this.showValue !== showValue) {
            this.showValue = showValue;
            this.buildRating();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setHalfPrecision(halfPrecision) {
        if (this.halfPrecision !== halfPrecision) {
            this.halfPrecision = halfPrecision;
            this.markDirty(DIRTY.PAINT);
        }
    }
    
    setError(error) {
        if (this.error !== error) {
            this.error = error;
            this.markDirty(DIRTY.PAINT);
        }
    }
    
    setLabel(label) {
        if (this.label !== label) {
            this.label = label;
            this.ariaLabel = label;
            this.markDirty(DIRTY.ACCESSIBILITY);
        }
    }
    
    setDescription(description) {
        if (this.description !== description) {
            this.description = description;
            this.ariaDescribedBy = description ? (this.id + '-description') : null;
            this.markDirty(DIRTY.ACCESSIBILITY);
        }
    }
    
    setName(name) {
        if (this.name !== name) {
            this.name = name;
            this.markDirty(DIRTY.PAINT);
        }
    }
    
    // Static factory methods
    static create(container, options = {}) {
        const id = options.id || _newRatingId();
        const rating = new Rating(id, options);
        if (container) {
            container.appendChild(widgetRenderer.render(rating));
        }
        return rating;
    }
    
    static getDefaultOptions() {
        return {
            value: 0,
            max: 5,
            disabled: false,
            readonly: false
        };
    }
    
    static createRating(id, options = {}) {
        return new Rating(id, options);
    }
    
    static createPrimaryRating(id, options = {}) {
        return new Rating(id, { variant: 'primary', ...options });
    }
    
    static createSuccessRating(id, options = {}) {
        return new Rating(id, { variant: 'success', ...options });
    }
    
    static createWarningRating(id, options = {}) {
        return new Rating(id, { variant: 'warning', ...options });
    }
    
    static createErrorRating(id, options = {}) {
        return new Rating(id, { variant: 'error', ...options });
    }
    
    static createSmallRating(id, options = {}) {
        return new Rating(id, { size: 'sm', ...options });
    }
    
    static createLargeRating(id, options = {}) {
        return new Rating(id, { size: 'lg', ...options });
    }
    
    static createXLargeRating(id, options = {}) {
        return new Rating(id, { size: 'xl', ...options });
    }
    
    static createFiveStarRating(id, options = {}) {
        return new Rating(id, { max: 5, ...options });
    }
    
    static createTenStarRating(id, options = {}) {
        return new Rating(id, { max: 10, ...options });
    }
    
    static createReadOnlyRating(id, options = {}) {
        return new Rating(id, { readonly: true, ...options });
    }
    
    static createHalfStarRating(id, options = {}) {
        return new Rating(id, { halfPrecision: true, ...options });
    }
    
    // Utility methods
    static createHotelRating(id, options = {}) {
        return new Rating(id, { max: 5, variant: 'warning', showValue: true, ...options });
    }
    
    static createProductRating(id, options = {}) {
        return new Rating(id, { max: 5, variant: 'primary', showValue: true, ...options });
    }
    
    static createServiceRating(id, options = {}) {
        return new Rating(id, { max: 5, variant: 'success', showValue: true, ...options });
    }
}
