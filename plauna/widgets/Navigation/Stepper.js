// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Stepper - Step indicator widget for Plauna
 * Provides stepper functionality with multiple variants and states
 */

import { UINode, NODE_STATE, DIRTY } from '../../core/UINode.js';
import { tokens } from '../../style/DesignTokens.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { tone as toneOf } from '../shared/appearance.js';

let _stepperSequence = 0;

function _newStepperId() {
    return `stepper-${Date.now()}-${++_stepperSequence}`;
}

export class Stepper extends UINode {
    // Widget metadata
    static id = 'stepper';
    static name = 'Stepper';
    static category = 'navigation';
    static icon = '📊';
    static description = 'Step indicator';
    static tags = ['navigation', 'stepper', 'steps'];
    static dependencies = [];
    
    static getDefaultOptions() {
        return {
            steps: [],
            current: 0,
            variant: 'default'
        };
    }
    
    static create(container, options = {}) {
        const instance = new Stepper(_newStepperId(), options);
        if (container && container instanceof HTMLElement) {
            const element = widgetRenderer.render(instance);
            container.appendChild(element);
        }
        return instance;
    }
    
    static stories() {
        return {
            'Default': {
                currentStep: 1,
                steps: [{ label: 'Import', description: 'Pick files' }, { label: 'Configure', description: 'Scale and axes' }, { label: 'Bake', description: 'Build LODs' }]
            }
        };
    }
    
    constructor(id = _newStepperId(), options = {}) {
        super(id, 'stepper');
        
        // Stepper-specific properties
        this.steps = options.steps || [];
        this.variant = options.variant || 'default'; // default, primary, secondary, success, warning, error, info
        this.size = options.size || 'md'; // xs, sm, md, lg, xl
        this.orientation = options.orientation || 'horizontal'; // horizontal, vertical
        this.currentStep = options.currentStep || 0;
        this.clickable = options.clickable !== false;
        this.showNumbers = options.showNumbers !== false;
        this.showLabels = options.showLabels !== false;
        this.showDescriptions = options.showDescriptions || false;
        this.alternativeLabels = options.alternativeLabels || false;
        this.linear = options.linear || false;
        this.completed = options.completed || false;
        
        // State management
        this.stepStates = new Map(); // Map of step index to state (pending, active, completed, error)
        this.initializeStepStates();
        
        // Set accessibility
        this.role = 'navigation';
        this.ariaLabel = options.ariaLabel || 'Step navigation';
        this.ariaOrientation = this.orientation;
        
        // Set default styles
        this.setupStyles();
        
        // Setup event handlers
        this.setupEventHandlers();
        
        // Build stepper structure
        this.buildStepper();
    }
    
    initializeStepStates() {
        this.steps.forEach((step, index) => {
            if (index < this.currentStep) {
                this.stepStates.set(index, 'completed');
            } else if (index === this.currentStep) {
                this.stepStates.set(index, 'active');
            } else {
                this.stepStates.set(index, 'pending');
            }
        });
    }
    
    setupStyles() {
        const sizeStyles = this.getSizeStyles();
        const variantStyles = this.getVariantStyles();
        const layoutStyles = this.getLayoutStyles();
        
        this.setStyles({
            display: this.orientation === 'horizontal' ? 'flex' : 'block',
            flexDirection: this.orientation === 'horizontal' ? 'row' : 'column',
            gap: tokens.css('spacing.md'),
            padding: this.getPadding(),
            backgroundColor: this.getBackgroundColor(),
            color: this.getTextColor(),
            border: 'none',
            borderRadius: tokens.css('borderRadius.md'),
            fontSize: 'inherit',
            fontWeight: tokens.css('fontWeights.medium'),
            outline: 'none',
            position: 'relative',
            transition: 'all 150ms ease',
            ...sizeStyles,
            ...variantStyles,
            ...layoutStyles
        });
    }
    
    getSizeStyles() {
        const sizes = {
            xs: {
                fontSize: tokens.css('fontSizes.xs'),
                padding: tokens.css('spacing.sm') + ' ' + tokens.css('spacing.md')
            },
            sm: {
                fontSize: tokens.css('fontSizes.sm'),
                padding: tokens.css('spacing.md') + ' ' + tokens.css('spacing.lg')
            },
            md: {
                fontSize: tokens.css('fontSizes.md'),
                padding: tokens.css('spacing.lg') + ' ' + tokens.css('spacing.xl')
            },
            lg: {
                fontSize: tokens.css('fontSizes.lg'),
                padding: tokens.css('spacing.xl') + ' ' + tokens.css('spacing.xxl')
            },
            xl: {
                fontSize: tokens.css('fontSizes.xl'),
                padding: tokens.css('spacing.xxl') + ' ' + tokens.css('spacing.xxxl')
            }
        };
        return sizes[this.size] || sizes.md;
    }
    
    getPadding() {
        const sizes = {
            xs: tokens.css('spacing.sm') + ' ' + tokens.css('spacing.md'),
            sm: tokens.css('spacing.md') + ' ' + tokens.css('spacing.lg'),
            md: tokens.css('spacing.lg') + ' ' + tokens.css('spacing.xl'),
            lg: tokens.css('spacing.xl') + ' ' + tokens.css('spacing.xxl'),
            xl: tokens.css('spacing.xxl') + ' ' + tokens.css('spacing.xxxl')
        };
        return sizes[this.size] || sizes.md;
    }
    
    getVariantStyles() {
        return { backgroundColor: 'transparent', color: this.getTextColor() };
    }

    /** The steps' tone (secondary is neutral, error is danger), or null for the plain default. */
    toneColors() {
        return this.variant && this.variant !== 'default' ? toneOf(this.variant) : null;
    }
    
    getLayoutStyles() {
        const layouts = {
            horizontal: {
                flexDirection: 'row',
                alignItems: 'center'
            },
            vertical: {
                flexDirection: 'column',
                alignItems: 'flex-start'
            }
        };
        return layouts[this.orientation] || layouts.horizontal;
    }
    
    getBackgroundColor() {
        return 'transparent';
    }
    
    getTextColor() {
        return this.toneColors()?.text ?? tokens.css('colors.text.primary');
    }
    
    getStepColor(state) {
        if (state === 'pending') return tokens.css('colors.text.secondary');
        if (state === 'error') return toneOf('danger').base;
        return this.toneColors()?.base ?? this.getTextColor();
    }
    
    getStepBackgroundColor(state) {
        if (state === 'pending') return 'var(--bg-secondary)';
        if (state === 'error') return toneOf('danger').soft;
        return this.toneColors()?.soft ?? tokens.css('colors.background.primary');
    }
    
    getStepBorderColor(state) {
        if (state === 'pending') return tokens.css('colors.border.medium');
        if (state === 'error') return toneOf('danger').base;
        return this.toneColors()?.base ?? this.getTextColor();
    }
    
    setupEventHandlers() {
        this.addEventListener('keydown', (e) => {
            this.handleKeyboardNavigation(e);
        });
    }
    
    handleKeyboardNavigation(e) {
        if (!this.clickable) return;
        
        switch (e.key) {
            case 'ArrowLeft':
            case 'ArrowUp':
                e.preventDefault();
                this.navigatePrevious();
                break;
            case 'ArrowRight':
            case 'ArrowDown':
                e.preventDefault();
                this.navigateNext();
                break;
            case 'Home':
                e.preventDefault();
                this.goToStep(0);
                break;
            case 'End':
                e.preventDefault();
                this.goToStep(this.steps.length - 1);
                break;
        }
    }
    
    buildStepper() {
        this.clearChildren();
        
        // Create stepper container
        const stepperContainer = document.createElement('div');
        stepperContainer.style.cssText = (
            'display: ' + (this.orientation === 'horizontal' ? 'flex' : 'block') + ';' +
            'flex-direction: ' + (this.orientation === 'horizontal' ? 'row' : 'column') + ';' +
            'gap: ' + tokens.css('spacing.sm') + ';' +
            'align-items: flex-start;' +
            'width: 100%;' +
            'position: relative;'
        );
        
        // Create steps
        this.steps.forEach((step, index) => {
            const stepElement = this.createStep(step, index);
            stepperContainer.appendChild(stepElement);
            
            // Add connector (except for last step)
            if (index < this.steps.length - 1) {
                const connector = this.createConnector(index);
                stepperContainer.appendChild(connector);
            }
        });
        
        this.appendElement(stepperContainer);
    }
    
    createStep(step, index) {
        const state = this.stepStates.get(index);
        const isActive = state === 'active';
        const isCompleted = state === 'completed';
        const hasError = state === 'error';
        
        const stepElement = document.createElement('div');
        stepElement.dataset.stepIndex = index.toString();
        stepElement.setAttribute('role', 'button');
        stepElement.setAttribute('aria-label', step.label || `Step ${index + 1}`);
        stepElement.setAttribute('aria-current', isActive ? 'step' : 'false');
        stepElement.setAttribute('aria-disabled', (!this.clickable || (this.linear && index > this.currentStep)).toString());
        stepElement.tabIndex = this.clickable && (!this.linear || index <= this.currentStep) ? (isActive ? '0' : '-1') : '-1';
        stepElement.style.cssText = (
            'display: flex;' +
            'flex-direction: ' + (this.orientation === 'horizontal' ? 'column' : 'row') + ';' +
            'align-items: ' + (this.orientation === 'horizontal' ? 'center' : 'flex-start') + ';' +
            'gap: ' + tokens.css('spacing.sm') + ';' +
            'cursor: ' + (this.clickable && (!this.linear || index <= this.currentStep) ? 'pointer' : 'default') + ';' +
            'transition: opacity 150ms ease;' +
            'position: relative;' +
            (this.orientation === 'horizontal' ? 'flex: 0 0 auto; min-width: 64px;' : 'flex: 0 0 auto;')
        );
        
        // Create step indicator
        const indicator = this.createStepIndicator(state, index);
        stepElement.appendChild(indicator);
        
        // Create step content
        if (this.showLabels || this.showDescriptions) {
            const content = this.createStepContent(step, state, index);
            stepElement.appendChild(content);
        }
        
        // Add click handler
        if (this.clickable && (!this.linear || index <= this.currentStep)) {
            stepElement.addEventListener('click', (e) => {
                e.stopPropagation();
                this.goToStep(index);
            });
            
            stepElement.addEventListener('mouseenter', () => {
                if (!isActive) {
                    stepElement.style.opacity = '0.8';
                }
            });
            
            stepElement.addEventListener('mouseleave', () => {
                if (!isActive) {
                    stepElement.style.opacity = '1';
                }
            });
        }
        
        return stepElement;
    }
    
    createStepIndicator(state, index) {
        const indicator = document.createElement('div');
        indicator.style.cssText = (
            'display: flex;' +
            'align-items: center;' +
            'justify-content: center;' +
            'width: 32px;' +
            'height: 32px;' +
            'border-radius: 50%;' +
            'border: 2px solid ' + this.getStepBorderColor(state) + ';' +
            'background: ' + this.getStepBackgroundColor(state) + ';' +
            'color: ' + this.getStepColor(state) + ';' +
            'font-size: ' + tokens.css('fontSizes.sm') + ';' +
            'font-weight: ' + tokens.css('fontWeights.bold') + ';' +
            'transition: all 150ms ease;' +
            'position: relative;' +
            'flex-shrink: 0;'
        );
        
        // Add step number or icon
        if (this.showNumbers) {
            const number = document.createElement('span');
            number.textContent = index + 1;
            indicator.appendChild(number);
        } else {
            // Add icon based on state
            const icon = document.createElement('span');
            if (state === 'completed') {
                icon.textContent = '✓';
            } else if (state === 'error') {
                icon.textContent = '✕';
            } else {
                icon.textContent = index + 1;
            }
            indicator.appendChild(icon);
        }
        
        return indicator;
    }
    
    createStepContent(step, state, index) {
        const content = document.createElement('div');
        content.style.cssText = (
            'display: flex;' +
            'flex-direction: column;' +
            'gap: ' + tokens.css('spacing.xs') + ';' +
            'text-align: ' + (this.orientation === 'horizontal' ? 'center' : 'left') + ';'
        );
        
        // Add label
        if (this.showLabels && step.label) {
            const label = document.createElement('div');
            label.textContent = step.label;
            label.style.cssText = (
                'font-size: ' + tokens.css('fontSizes.sm') + ';' +
                'font-weight: ' + (state === 'active' ? tokens.css('fontWeights.semibold') : tokens.css('fontWeights.medium')) + ';' +
                'color: ' + this.getStepColor(state) + ';' +
                'line-height: 1.2;'
            );
            content.appendChild(label);
        }
        
        // Add description
        if (this.showDescriptions && step.description) {
            const description = document.createElement('div');
            description.textContent = step.description;
            description.style.cssText = (
                'font-size: ' + tokens.css('fontSizes.xs') + ';' +
                'color: ' + tokens.css('colors.text.secondary') + ';' +
                'line-height: 1.3;' +
                'opacity: 0.8;'
            );
            content.appendChild(description);
        }
        
        return content;
    }
    
    createConnector(index) {
        const connector = document.createElement('div');
        const currentState = this.stepStates.get(index);
        const nextState = this.stepStates.get(index + 1);
        const isCompleted = currentState === 'completed' && nextState !== 'error';
        
        // A flex item between two steps, level with the indicators' centres
        connector.setAttribute('aria-hidden', 'true');
        connector.style.cssText = (
            (this.orientation === 'horizontal' ?
                'flex: 1 1 auto;' +
                'min-width: 24px;' +
                'height: 2px;' +
                'margin-top: 15px;' :
                'width: 2px;' +
                'min-height: 20px;' +
                'margin-left: 15px;'
            ) +
            'border-radius: 1px;' +
            'background: ' + (isCompleted ? this.getStepColor('completed') : this.getStepBorderColor('pending')) + ';' +
            'transition: background-color 150ms ease;'
        );
        
        return connector;
    }
    
    // Public methods
    goToStep(stepIndex) {
        if (stepIndex < 0 || stepIndex >= this.steps.length) return;
        
        if (this.linear && stepIndex > this.currentStep + 1) return;
        
        const previousStep = this.currentStep;
        this.currentStep = stepIndex;
        
        // Update step states
        this.initializeStepStates();
        
        // Rebuild stepper
        this.buildStepper();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        
        this.dispatchEvent({
            type: 'stepChange',
            bubbles: true,
            detail: {
                currentStep: this.currentStep,
                previousStep: previousStep,
                step: this.steps[this.currentStep],
                totalSteps: this.steps.length
            }
        });
    }
    
    navigateNext() {
        if (this.currentStep < this.steps.length - 1) {
            this.goToStep(this.currentStep + 1);
        }
    }
    
    navigatePrevious() {
        if (this.currentStep > 0) {
            this.goToStep(this.currentStep - 1);
        }
    }
    
    setStepState(stepIndex, state) {
        if (stepIndex >= 0 && stepIndex < this.steps.length) {
            this.stepStates.set(stepIndex, state);
            this.buildStepper();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setVariant(variant) {
        if (this.variant !== variant) {
            this.variant = variant;
            this.setupStyles();
            this.buildStepper();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setSize(size) {
        if (this.size !== size) {
            this.size = size;
            this.setupStyles();
            this.buildStepper();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setOrientation(orientation) {
        if (this.orientation !== orientation) {
            this.orientation = orientation;
            this.ariaOrientation = orientation;
            this.setupStyles();
            this.buildStepper();
            this.markDirty(DIRTY.STYLE | DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT | DIRTY.ACCESSIBILITY);
        }
    }
    
    setSteps(steps) {
        this.steps = steps || [];
        this.currentStep = Math.min(this.currentStep, this.steps.length - 1);
        this.initializeStepStates();
        this.buildStepper();
        this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
    }
    
    setClickable(clickable) {
        if (this.clickable !== clickable) {
            this.clickable = clickable;
            this.buildStepper();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setLinear(linear) {
        if (this.linear !== linear) {
            this.linear = linear;
            this.buildStepper();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setShowNumbers(showNumbers) {
        if (this.showNumbers !== showNumbers) {
            this.showNumbers = showNumbers;
            this.buildStepper();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setShowLabels(showLabels) {
        if (this.showLabels !== showLabels) {
            this.showLabels = showLabels;
            this.buildStepper();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setShowDescriptions(showDescriptions) {
        if (this.showDescriptions !== showDescriptions) {
            this.showDescriptions = showDescriptions;
            this.buildStepper();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setAlternativeLabels(alternativeLabels) {
        if (this.alternativeLabels !== alternativeLabels) {
            this.alternativeLabels = alternativeLabels;
            this.buildStepper();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    setCompleted(completed) {
        if (this.completed !== completed) {
            this.completed = completed;
            if (completed) {
                // Mark all steps as completed
                this.steps.forEach((_, index) => {
                    this.stepStates.set(index, 'completed');
                });
            } else {
                this.initializeStepStates();
            }
            this.buildStepper();
            this.markDirty(DIRTY.CHILDREN | DIRTY.LAYOUT | DIRTY.PAINT);
        }
    }
    
    // Static factory methods
    static createStepper(id, options = {}) {
        return new Stepper(id, options);
    }
    
    static createPrimaryStepper(id, options = {}) {
        return new Stepper(id, { variant: 'primary', ...options });
    }
    
    static createSecondaryStepper(id, options = {}) {
        return new Stepper(id, { variant: 'secondary', ...options });
    }
    
    static createSuccessStepper(id, options = {}) {
        return new Stepper(id, { variant: 'success', ...options });
    }
    
    static createWarningStepper(id, options = {}) {
        return new Stepper(id, { variant: 'warning', ...options });
    }
    
    static createErrorStepper(id, options = {}) {
        return new Stepper(id, { variant: 'error', ...options });
    }
    
    static createInfoStepper(id, options = {}) {
        return new Stepper(id, { variant: 'info', ...options });
    }
    
    static createHorizontalStepper(id, options = {}) {
        return new Stepper(id, { orientation: 'horizontal', ...options });
    }
    
    static createVerticalStepper(id, options = {}) {
        return new Stepper(id, { orientation: 'vertical', ...options });
    }
    
    static createLinearStepper(id, options = {}) {
        return new Stepper(id, { linear: true, ...options });
    }
    
    static createNonLinearStepper(id, options = {}) {
        return new Stepper(id, { linear: false, ...options });
    }
    
    static createClickableStepper(id, options = {}) {
        return new Stepper(id, { clickable: true, ...options });
    }
    
    static createReadOnlyStepper(id, options = {}) {
        return new Stepper(id, { clickable: false, ...options });
    }
    
    static createWizardStepper(id, options = {}) {
        return new Stepper(id, {
            variant: 'primary',
            orientation: 'horizontal',
            linear: true,
            clickable: true,
            showNumbers: true,
            showLabels: true,
            showDescriptions: false,
            ...options
        });
    }
    
    static createProcessStepper(id, options = {}) {
        return new Stepper(id, {
            variant: 'success',
            orientation: 'vertical',
            linear: true,
            clickable: false,
            showNumbers: true,
            showLabels: true,
            showDescriptions: true,
            ...options
        });
    }
    
    static createTimelineStepper(id, options = {}) {
        return new Stepper(id, {
            variant: 'default',
            orientation: 'vertical',
            linear: false,
            clickable: true,
            showNumbers: false,
            showLabels: true,
            showDescriptions: true,
            ...options
        });
    }
    
    static createOnboardingStepper(id, options = {}) {
        return new Stepper(id, {
            variant: 'info',
            orientation: 'horizontal',
            linear: true,
            clickable: true,
            showNumbers: true,
            showLabels: true,
            showDescriptions: false,
            ...options
        });
    }
    
    static createCheckoutStepper(id, options = {}) {
        return new Stepper(id, {
            variant: 'primary',
            orientation: 'horizontal',
            linear: true,
            clickable: false,
            showNumbers: true,
            showLabels: true,
            showDescriptions: false,
            ...options
        });
    }
}
