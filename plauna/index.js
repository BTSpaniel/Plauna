// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: MIT

/**
 * Plauna - Advanced UI System for Particle Engine
 * Browser-first UI runtime with hybrid DOM/GPU rendering
 *
 * ============================================================================
 * MODULE STRUCTURE
 * ============================================================================
 *
 * This is the main entry point for the Plauna UI system. It re-exports
 * all public APIs in a structured, organized manner.
 *
 * Export Categories:
 *
 * Core System:
 * - createPlaunaApp: Main application entry point
 * - PlaunaModuleTester: Module testing utilities
 * - UINode, DIRTY, NODE_STATE: Core retained-mode UI tree
 * - VisualTree: Visual tree management
 *
 * UI Components:
 * - PlaunaSmartContextMenu: Type-aware context menu for debugging
 * - PlaunaTextService: Internationalization service (Pretext)
 * - PlaunaSurfaceManager: Surface/layer management
 * - PlaunaGPUBridge: WebGPU integration bridge
 *
 * Widget System:
 * - Every widget in the registry (widgets/index.js), by category
 * - Registry helpers: widgets, widgetRegistry, getWidget, getAllCategories, ...
 * - DOMRenderer / WidgetRenderer: the one UINode → DOM renderer
 *
 * Utilities:
 * - Style system: Design tokens, theme management
 * - Console system: PlaunaConsole for debugging
 * - Notification system: Toast, Notify
 * - Particle controller: ParticleController for particle integration
 *
 * Lab/Development:
 * - mountPlaunaWorkbenchLab: Workbench development environment
 * - mountShowcaseApp: Widget showcase application
 */

// ============================================================================
// CORE SYSTEM EXPORTS
// ============================================================================

export { PLAUNA_VERSION, PLAUNA_FULL, BUILD_TAG } from '../engine/version.js';
export { createPlaunaApp } from './core/app.js';
export { PlaunaModuleTester } from './core/ModuleTester.js';

// ============================================================================
// UI COMPONENT EXPORTS
// ============================================================================

export { PlaunaSmartContextMenu } from './ui/SmartContextMenu.js';
export { PlaunaTextService } from './text/pretext-service.js';
export { PlaunaSurfaceManager } from './surface/surface-manager.js';
export { PlaunaGPUBridge, projectToScreen } from './particle/bridge.js';

// ============================================================================
// LAB/DEVELOPMENT EXPORTS
// ============================================================================

export { mountPlaunaWorkbenchLab } from './lab/workbench-lab.js';
export { mountShowcaseApp, ShowcaseApp } from './lab/showcase-app.js';

// ============================================================================
// MOTION / TRANSITIONS
// ============================================================================

export { TransitionEngine, TransitionUtils } from './motion/TransitionEngine.js';
export { PageTransition, startPageTransition } from './motion/PageTransition.js';

// ============================================================================
// CONSOLE SYSTEM EXPORTS
// ============================================================================

export { createPlaunaConsole, getPlaunaConsole, PlaunaConsole } from './console/PlaunaConsole.js';

// ============================================================================
// STYLE SYSTEM EXPORTS
// ============================================================================

export * from './style/index.js';

// ============================================================================
// CORE UINODE EXPORTS
// ============================================================================

export { UINode, DIRTY, NODE_STATE, INPUT_FLAGS, RENDER_FLAGS } from './core/UINode.js';

// ============================================================================
// VISUAL TREE EXPORTS
// ============================================================================

export { VisualTree } from './core/VisualTree.js';

// ============================================================================
// CORE UTILITIES EXPORTS
// ============================================================================

export * from './core/registry.js';
export * from './core/events.js';
export { StateStore, createStore, useStore } from './core/StateStore.js';
export { BindingEngine, BindingUtils } from './core/BindingEngine.js';

// ============================================================================
// NOTIFICATION SYSTEM EXPORTS
// ============================================================================

export { Toast, ToastManager } from './ui/ToastManager.js';
export { Notify, NotificationSystem } from './notifications/NotificationSystem.js';

// ============================================================================
// PARTICLE CONTROLLER EXPORTS
// ============================================================================

export { ParticleController } from './particle/ParticleController.js';

// ============================================================================
// RENDERING EXPORTS
// ============================================================================

export { DOMRenderer } from './core/DOMRenderer.js';
export { WidgetRenderer, widgetRenderer } from './widgets/WidgetRenderer.js';
export { ElementNode } from './core/UINode.js';

// ============================================================================
// WIDGET REGISTRY EXPORTS
// ============================================================================

export {
    widgets,
    widgetRegistry,
    categories,
    getWidget,
    getWidgetsByCategory,
    getAllCategories,
    getAllWidgets,
    searchWidgets,
    getWidgetsByTag,
    getWidgetDependencies,
    validateWidgetDependencies,
    createWidget,
    createWidgetWithTheme,
    getWidgetMetadata,
    getAllWidgetMetadata,
    getWidgetDocumentation,
    getWidgetStats
} from './widgets/index.js';

// ============================================================================
// PRIMITIVE WIDGET EXPORTS
// ============================================================================

export { Avatar } from './widgets/Primitive/Avatar.js';
export { Badge } from './widgets/Primitive/Badge.js';
export { Button } from './widgets/Primitive/Button.js';
export { Chip } from './widgets/Primitive/Chip.js';
export { Modal } from './widgets/Primitive/Modal.js';
export { Panel } from './widgets/Primitive/Panel.js';
export { Progress } from './widgets/Primitive/Progress.js';
export { Skeleton } from './widgets/Primitive/Skeleton.js';
export { Text } from './widgets/Primitive/Text.js';
export { Tooltip } from './widgets/Primitive/Tooltip.js';
export { Kbd } from './widgets/Primitive/Kbd.js';
export { Code, tokenizeLine } from './widgets/Primitive/Code.js';
export { AvatarGroup } from './widgets/Primitive/AvatarGroup.js';
export { Popover } from './widgets/Primitive/Popover.js';
export { Drawer } from './widgets/Primitive/Drawer.js';
export { IconButton } from './widgets/Primitive/IconButton.js';
export { RollingNumber, formatRolling } from './widgets/Primitive/RollingNumber.js';
export { Spoiler } from './widgets/Primitive/Spoiler.js';

// ============================================================================
// INPUT WIDGET EXPORTS
// ============================================================================

export { Input } from './widgets/Input/Input.js';
export { Search } from './widgets/Input/Search.js';
export { Color } from './widgets/Input/Color.js';
export { Date as DateInput } from './widgets/Input/Date.js';
export { File as FileInput } from './widgets/Input/File.js';
export { Number as NumberInput } from './widgets/Input/Number.js';
export { Range, Range as Slider } from './widgets/Input/Range.js';
export { Tag } from './widgets/Input/Tag.js';
export { Time } from './widgets/Input/Time.js';
export { Upload } from './widgets/Input/Upload.js';
export { SegmentedControl } from './widgets/Input/SegmentedControl.js';
export { PinInput } from './widgets/Input/PinInput.js';
export { Password, passwordScore } from './widgets/Input/Password.js';
export { Combobox } from './widgets/Input/Combobox.js';
export { ColorPicker, hsvToRgb, rgbToHsv, rgbToHex, hexToRgb } from './widgets/Input/ColorPicker.js';
export { RangeSlider } from './widgets/Input/RangeSlider.js';
export { MultiSelect } from './widgets/Input/MultiSelect.js';
export { DatePicker, formatDay } from './widgets/Input/DatePicker.js';
export { Toggle } from './widgets/Input/Toggle.js';

// ============================================================================
// FORM WIDGET EXPORTS
// ============================================================================

export { Checkbox } from './widgets/Form/Checkbox.js';
export { Radio } from './widgets/Form/Radio.js';
export { Switch } from './widgets/Form/Switch.js';
export { Select } from './widgets/Form/Select.js';
export { Textarea } from './widgets/Form/Textarea.js';
export { Rating } from './widgets/Form/Rating.js';

// ============================================================================
// LAYOUT WIDGET EXPORTS
// ============================================================================

export { Collapse } from './widgets/Layout/Collapse.js';
export { Container } from './widgets/Layout/Container.js';
export { Divider } from './widgets/Layout/Divider.js';
export { Grid } from './widgets/Layout/Grid.js';
export { HeaderFooter } from './widgets/Layout/HeaderFooter.js';
export { Section } from './widgets/Layout/Section.js';
export { Spacer } from './widgets/Layout/Spacer.js';
export { SplitPane } from './widgets/Layout/SplitPane.js';
export { Stack } from './widgets/Layout/Stack.js';
export { Accordion } from './widgets/Layout/Accordion.js';
export { Marquee } from './widgets/Layout/Marquee.js';

// ============================================================================
// NAVIGATION WIDGET EXPORTS
// ============================================================================

export { Breadcrumb } from './widgets/Navigation/Breadcrumb.js';
export { Dropdown } from './widgets/Navigation/Dropdown.js';
export { Menu } from './widgets/Navigation/Menu.js';
export { Navbar } from './widgets/Navigation/Navbar.js';
export { Pagination } from './widgets/Navigation/Pagination.js';
export { Sidebar } from './widgets/Navigation/Sidebar.js';
export { Stepper } from './widgets/Navigation/Stepper.js';
export { Tabs } from './widgets/Navigation/Tabs.js';
export { CommandPalette } from './widgets/Navigation/CommandPalette.js';
export { Toolbar } from './widgets/Navigation/Toolbar.js';
export { Menubar } from './widgets/Navigation/Menubar.js';
export { TableOfContents } from './widgets/Navigation/TableOfContents.js';
export { SpeedDial } from './widgets/Navigation/SpeedDial.js';

// ============================================================================
// FEEDBACK WIDGET EXPORTS
// ============================================================================

export { Alert } from './widgets/Feedback/Alert.js';
export { EmptyState } from './widgets/Feedback/EmptyState.js';
export { Spinner } from './widgets/Feedback/Spinner.js';
export { Status } from './widgets/Feedback/Status.js';
export { Toast as ToastWidget } from './widgets/Feedback/Toast.js';
export { Banner } from './widgets/Feedback/Banner.js';
export { Meter } from './widgets/Feedback/Meter.js';
export { ConfirmDialog } from './widgets/Feedback/ConfirmDialog.js';
export { Result } from './widgets/Feedback/Result.js';

// ============================================================================
// DATA VIEW WIDGET EXPORTS
// ============================================================================

export { Card } from './widgets/DataViews/Card.js';
export { List } from './widgets/DataViews/List.js';
export { ListView } from './widgets/DataViews/ListView.js';
export { Table } from './widgets/DataViews/Table.js';
export { Tree } from './widgets/DataViews/Tree.js';
export { Sparkline } from './widgets/DataViews/Sparkline.js';
export { Stat } from './widgets/DataViews/Stat.js';
export { Timeline } from './widgets/DataViews/Timeline.js';
export { Calendar } from './widgets/DataViews/Calendar.js';
export { KeyValue } from './widgets/DataViews/KeyValue.js';
export { Carousel } from './widgets/DataViews/Carousel.js';
export { ImageView, SAMPLE_LANDSCAPE } from './widgets/DataViews/Image.js';
export { DonutChart } from './widgets/DataViews/DonutChart.js';
export { BarChart, niceMax } from './widgets/DataViews/BarChart.js';
export { ChatThread } from './widgets/DataViews/ChatThread.js';

// Shared look: tones, variants, sizes and interaction states for custom widgets
export { TONES, VARIANTS, SIZES, SHAPES, RADII, tone, toneName, variantStyles, sizeScale, radiusFor, bindInteraction, ICONS } from './widgets/shared/appearance.js';

// ============================================================================
// RENDERING - DOM, GPU and auto render modes
// ============================================================================

export {
    RenderSurface,
    RENDER_MODES,
    normalizeRenderMode,
    gpuAvailable,
    LayoutEngine,
    StyleResolver,
    TextShaper,
    AnimationController
} from './render/index.js';
