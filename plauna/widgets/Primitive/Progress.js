// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Progress - Task completion indicator widget for Plauna
 * Provides linear and circular progress indicators with multiple states
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { lerp } from '../../../engine/core/math/MathScalar.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { tone as toneOf, mix, ensureKeyframes } from '../shared/appearance.js';

let _progressSequence = 0;

function _newProgressId() {
    return `progress-${Date.now()}-${++_progressSequence}`;
}

export class Progress extends UINode {
    // Widget metadata
    static id = 'progress';
    static name = 'Progress';
    static category = 'primitive';
    static icon = '📊';
    static description = 'Progress indicator';
    static tags = ['primitive', 'progress'];
    static dependencies = [];
    static optionValues = { variant: ['default', 'success', 'warning', 'error', 'info', 'accent'], type: ['linear', 'circular'], size: ['xs', 'sm', 'md', 'lg', 'xl'], striped: 'boolean', animated: 'boolean', indeterminate: 'boolean', showPercentage: 'boolean' };
    
    static getDefaultOptions() {
        return {
            value: 0,
            max: 100,
            variant: 'default',
            type: 'linear'
        };
    }

    static stories() {
        return {
            'Empty':     { value: 0,   max: 100, size: 'lg', showPercentage: false },
            'Quarter':   { value: 25,  max: 100, size: 'lg', showPercentage: false },
            'Half':      { value: 50,  max: 100, size: 'lg', showPercentage: false },
            'Full':      { value: 100, max: 100, size: 'lg', showPercentage: false },
            'Success':   { value: 75,  max: 100, variant: 'success', size: 'lg', showPercentage: false },
            'Warning':   { value: 40,  max: 100, variant: 'warning', size: 'lg', showPercentage: false },
            'Striped':   { value: 62,  max: 100, variant: 'info', size: 'xl', striped: true, showPercentage: false },
            'Indeterminate': { value: 0, max: 100, size: 'lg', indeterminate: true, variant: 'accent' },
            'Circular':  { value: 72,  max: 100, type: 'circular', size: 'lg', variant: 'success' },
        };
    }
    
    static create(container, options = {}) {
        const instance = new Progress(_newProgressId(), options);
        if (container && container instanceof HTMLElement) {
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    constructor(id = _newProgressId(), options = {}) {
        super(id, 'progress');
        // A composite widget: render a <div>, not the native <progress> element
        this.tag = 'div';
        
        // Progress-specific properties
        this.value = options.value || 0;
        this.max = options.max || 100;
        this.type = options.type || 'linear'; // linear, circular
        this.variant = options.variant || 'default'; // default, success, warning, error, info
        this.size = options.size || 'md';
        this.indeterminate = options.indeterminate || false;
        this.showPercentage = options.showPercentage !== false;
        this.striped = options.striped || false;
        this.animated = options.animated !== false;
        
        // State management
        this.animationFrame = null;
        
        // Set accessibility
        /**
         * Accessibility pattern for progress indicators.
         *
         * ARIA attributes for screen reader support:
         * - role="progressbar": Identifies element as progress indicator
         * - ariaValueMin/Max/Now: Communicates progress range and current value
         * - ariaLabel: Describes what the progress represents
         */
        this.role = 'progressbar';
        this.ariaLabel = options.ariaLabel || 'Progress indicator';
        this.ariaValueMin = '0';
        this.ariaValueMax = this.max.toString();
        this.ariaValueNow = this.value.toString();

        this.updateClassName();
        
        // Set default styles
        this.setupStyles();
        
        // Build progress structure
        this.buildProgress();
    }

    updateClassName() {
        const parts = ['progress', `progress--${this.size}`, `progress--${this.variant}`];
        if (this.indeterminate) {
            parts.push('progress--indeterminate');
        }
        if (this.type === 'circular') {
            parts.push('progress--circular');
        }
        this.className = parts.join(' ');
    }
    
    setupStyles() {
        const sizeStyles = this.getSizeStyles();
        const variantStyles = this.getVariantStyles();
        
        void variantStyles;
        // The track: a faint mix of the text colour, visible on any surface in any theme
        this.setStyles({
            display: this.type === 'circular' ? 'inline-block' : 'block',
            position: 'relative',
            width: this.type === 'circular' ? `${this.getCircleSize()}px` : sizeStyles.width,
            height: this.type === 'circular' ? `${this.getCircleSize()}px` : sizeStyles.height,
            backgroundColor: this.type === 'circular' ? 'transparent' : mix('var(--text-primary, #e4e4e7)', 10),
            borderRadius: this.type === 'circular' ? '50%' : '9999px',
            overflow: 'hidden'
        });
    }
    
    getSizeStyles() {
        const sizes = {
            xs: {
                width: '80px',
                height: '8px'
            },
            sm: {
                width: '120px',
                height: '10px'
            },
            md: {
                width: '160px',
                height: '12px'
            },
            lg: {
                width: '220px',
                height: '16px'
            },
            xl: {
                width: '280px',
                height: '20px'
            },
            '2xl': {
                width: '340px',
                height: '24px'
            }
        };
        return sizes[this.size] || sizes.md;
    }
    
    getVariantStyles() {
        const variants = {
            default: {
                backgroundColor: 'var(--bg-tertiary)'
            },
            success: {
                backgroundColor: 'var(--color-success)'
            },
            warning: {
                backgroundColor: 'var(--color-warning)'
            },
            error: {
                backgroundColor: 'var(--color-error)'
            },
            info: {
                backgroundColor: 'var(--color-info)'
            }
        };
        return variants[this.variant] || variants.default;
    }
    
    buildProgress() {
        this.clearChildren();
        
        if (this.type === 'linear') {
            this.buildLinearProgress();
        } else if (this.type === 'circular') {
            this.buildCircularProgress();
        }
        
        // Add percentage text if enabled
        if (this.showPercentage && !this.indeterminate) {
            this.buildPercentageText();
        }
    }
    
    buildLinearProgress() {
        const progressContainer = new UINode(`${this.id}-container`, 'div');
        progressContainer.className = 'progress__bar';
        progressContainer.setStyles({
            width: '100%',
            height: '100%',
            position: 'relative',
            backgroundColor: 'transparent',
            borderRadius: 'inherit'
        });
        
        // Progress bar
        const progressBar = new UINode(`${this.id}-bar`, 'div');
        progressBar.className = 'progress__fill';
        progressBar.setStyles({
            position: 'absolute',
            top: '0',
            left: '0',
            height: '100%',
            width: this.calculateProgressWidth() + '%',
            backgroundColor: this.getProgressColor(),
            backgroundImage: `linear-gradient(90deg, ${this.getTone().hover}, ${this.getTone().base})`,
            boxShadow: `0 0 10px ${this.getTone().glow}`,
            borderRadius: 'inherit',
            transition: this.animated ? 'width 300ms ease' : 'none'
        });
        
        // Add striped animation if enabled
        if (this.striped) {
            ensureKeyframes('progressStriped', 'from { background-position: 40px 0; } to { background-position: 0 0; }');
            progressBar.setStyles({
                backgroundImage: 'linear-gradient(45deg, rgba(255, 255, 255, 0.18) 25%, transparent 25%, transparent 50%, rgba(255, 255, 255, 0.18) 50%, rgba(255, 255, 255, 0.18) 75%, transparent 75%, transparent)',
                backgroundSize: '40px 40px',
                animation: this.animated ? 'progressStriped 1s linear infinite' : 'none'
            });
        }
        
        // Add indeterminate animation if enabled
        if (this.indeterminate) {
            ensureKeyframes('progressIndeterminate', 'from { transform: translateX(-100%); } to { transform: translateX(340%); }');
            // At rest the bar sits where the animation starts, so layout and the
            // first frame agree; without animation it rests in the middle
            progressBar.setStyles({
                width: '30%',
                transform: this.animated ? 'translateX(-100%)' : 'translateX(116%)',
                animation: this.animated ? 'progressIndeterminate 1.5s ease-in-out infinite' : 'none'
            });
        }
        
        progressContainer.appendChild(progressBar);
        this.appendChild(progressContainer);
    }
    
    /** Diameter of the circular progress for its size (px). */
    getCircleSize() {
        return { xs: 32, sm: 40, md: 56, lg: 72, xl: 96, '2xl': 120 }[this.size] || 56;
    }

    // Circle geometry for the current size and value
    getCircleGeometry() {
        const svgSize = this.getCircleSize();
        const strokeWidth = Math.max(3, Math.round(svgSize / 10));
        const radius = (svgSize - strokeWidth) / 2;
        const circumference = 2 * Math.PI * radius;
        const offset = circumference - (this.calculateProgressWidth() / 100) * circumference;
        return { svgSize, strokeWidth, radius, circumference, offset };
    }

    buildCircularProgress() {
        const { svgSize, strokeWidth, radius, circumference, offset } = this.getCircleGeometry();
        const center = radius + strokeWidth / 2;

        const svg = new UINode(`${this.id}-svg`, 'svg');
        svg.userData.viewBox = `0 0 ${svgSize} ${svgSize}`;
        svg.userData.width = String(svgSize);
        svg.userData.height = String(svgSize);
        svg.setStyles({ display: 'block' });
        // Start at 12 o'clock: an SVG rotation (CSS deg units are not valid in SVG attributes)
        const ring = new UINode(`${this.id}-ring`, 'g');
        ring.userData.transform = `rotate(-90 ${center} ${center})`;
        svg.appendChild(ring);

        // Track ring, then the value ring on top. Colours go in styles: SVG
        // presentation attributes do not resolve var()
        const track = new UINode(`${this.id}-track`, 'circle');
        Object.assign(track.userData, {
            cx: String(center), cy: String(center), r: String(radius),
            fill: 'none', 'stroke-width': String(strokeWidth)
        });
        track.setStyles({ stroke: mix('var(--text-primary, #e4e4e7)', 12) });
        ring.appendChild(track);

        const circle = new UINode(`${this.id}-circle`, 'circle');
        Object.assign(circle.userData, {
            cx: String(center), cy: String(center), r: String(radius),
            fill: 'none', 'stroke-width': String(strokeWidth),
            'stroke-linecap': 'round', 'stroke-dasharray': String(circumference),
            'stroke-dashoffset': String(this.indeterminate ? circumference * 0.75 : offset)
        });
        circle.setStyles({
            stroke: this.getProgressColor(),
            transition: this.animated ? 'stroke-dashoffset 300ms ease-in-out' : 'none',
            animation: this.indeterminate && this.animated ? 'progressCircularIndeterminate 2s ease-in-out infinite' : 'none'
        });
        ring.appendChild(circle);
        this._circle = circle;

        this.appendChild(svg);
    }
    
    buildPercentageText() {
        const text = new UINode(`${this.id}-text`, 'span');
        text.textContent = this.indeterminate ? '...' : `${this.calculateProgressWidth()}%`;
        text.setStyles({
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            fontSize: '0.75em',
            fontWeight: 'var(--font-weight-semibold)',
            color: 'var(--text-primary)',
            whiteSpace: 'nowrap',
            pointerEvents: 'none'
        });
        this.appendChild(text);
    }
    
    calculateProgressWidth() {
        if (this.indeterminate) {
            return 0;
        }
        return Math.min(100, Math.max(0, (this.value / this.max) * 100));
    }
    
    /** The fill's tone: default is primary, error is danger. */
    getTone() {
        return toneOf(this.variant === 'default' ? 'primary' : this.variant);
    }

    getProgressColor() {
        if (!['default', 'success', 'warning', 'error', 'info'].includes(this.variant)) return this.getTone().base;
        const colors = {
            default: 'var(--color-primary-500)',
            success: 'var(--color-success)',
            warning: 'var(--color-warning)',
            error: 'var(--color-error)',
            info: 'var(--color-info)'
        };
        return colors[this.variant] || colors.default;
    }
    
    setValue(value) {
        if (value !== this.value) {
            this.value = value;
            this.ariaValueNow = this.value.toString();
            
            // Update UI
            this.updateProgress();
            this.markDirty(DIRTY.PAINT);
        }
    }
    
    setMax(max) {
        if (max !== this.max) {
            this.max = max;
            this.ariaValueMax = this.max.toString();
            
            // Update UI
            this.updateProgress();
            this.markDirty(DIRTY.PAINT);
        }
    }
    
    setVariant(variant) {
        if (variant !== this.variant) {
            this.variant = variant;
            this.updateClassName();
            this.setupStyles();
            this.buildProgress();
            this.markDirty(DIRTY.STYLE | DIRTY.PAINT);
        }
    }
    
    setSize(size) {
        if (size !== this.size) {
            this.size = size;
            this.updateClassName();
            this.setupStyles();
            this.buildProgress();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setType(type) {
        if (type !== this.type) {
            this.type = type;
            this.updateClassName();
            this.setupStyles();
            this.buildProgress();
            this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setIndeterminate(indeterminate) {
        if (indeterminate !== this.indeterminate) {
            this.indeterminate = indeterminate;
            this.ariaLabel = indeterminate ? 'Loading' : 'Progress indicator';
            this.updateClassName();
            
            // Update UI
            this.buildProgress();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setShowPercentage(showPercentage) {
        if (showPercentage !== this.showPercentage) {
            this.showPercentage = showPercentage;
            this.buildProgress();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setStriped(striped) {
        if (striped !== this.striped) {
            this.striped = striped;
            this.updateClassName();
            this.buildProgress();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setAnimated(animated) {
        if (animated !== this.animated) {
            this.animated = animated;
            this.updateClassName();
            this.buildProgress();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    updateProgress() {
        if (this.type === 'linear') {
            const progressBar = this.querySelector(`#${this.id}-bar`);
            if (progressBar) {
                if (this.indeterminate) {
                    progressBar.setStyle('width', '30%');
                } else {
                    progressBar.setStyle('width', this.calculateProgressWidth() + '%');
                }
            }
        } else if (this.type === 'circular' && this._circle) {
            const { circumference, offset } = this.getCircleGeometry();
            this._circle.userData['stroke-dashoffset'] = String(this.indeterminate ? circumference * 0.75 : offset);
            this._circle.markDirty(DIRTY.PAINT);
        }
        
        // Update percentage text
        if (this.showPercentage && !this.indeterminate) {
            const text = this.querySelector(`#${this.id}-text`);
            if (text) {
                text.setTextContent(`${this.calculateProgressWidth()}%`);
            }
        }
    }
    
    // Static factory methods for common progress types
    static createLinearProgress(id, options = {}) {
        return new Progress(id, {
            type: 'linear',
            ...options
        });
    }
    
    static createCircularProgress(id, options = {}) {
        return new Progress(id, {
            type: 'circular',
            ...options
        });
    }
    
    static createSuccessProgress(id, options = {}) {
        return new Progress(id, {
            variant: 'success',
            ...options
        });
    }
    
    static createWarningProgress(id, options = {}) {
        return new Progress(id, {
            variant: 'warning',
            ...options
        });
    }
    
    static createErrorProgress(id, options = {}) {
        return new Progress(id, {
            variant: 'error',
            ...options
        });
    }
    
    static createInfoProgress(id, options = {}) {
        return new Progress(id, {
            variant: 'info',
            ...options
        });
    }
    
    static createIndeterminateProgress(id, options = {}) {
        return new Progress(id, {
            indeterminate: true,
            animated: true,
            showPercentage: false,
            ...options
        });
    }
    
    static createProgressBar(id, value, max, options = {}) {
        return new Progress(id, {
            value,
            max,
            showPercentage: true,
            ...options
        });
    }
    
    // Animation helpers
    animateTo(targetValue, duration = 300) {
        const startValue = this.value;
        const startTime = Date.now();
        
        const animate = () => {
            const currentTime = Date.now();
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration);
            
            const currentValue = lerp(startValue, targetValue, progress);
            this.setValue(currentValue);
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            }
        };
        
        requestAnimationFrame(animate);
    }
    
    // CSS animations for progress bars
    static getCSSAnimations() {
        return `
            @keyframes progressStriped {
                0% {
                    background-position: 40px 0;
                }
                100% {
                    background-position: 0 0;
                }
            }
            
            @keyframes progressIndeterminate {
                0% {
                    left: -30%;
                }
                60% {
                    left: 100%;
                }
                100% {
                    left: 100%;
                }
            }
            
            @keyframes progressCircularIndeterminate {
                0% {
                    stroke-dasharray: 1, 2;
                    stroke-dashoffset: 0;
                }
                50% {
                    stroke-dasharray: 90, 150;
                    stroke-dashoffset: -35;
                }
                100% {
                    stroke-dasharray: 90, 150;
                    stroke-dashoffset: -124;
                }
            }
        `;
    }
}
