// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * ============================================================================
 * PLAUNA WIDGET REGISTRY
 * ============================================================================
 *
 * This file serves as the central registry for all Plauna widgets.
 * It imports widgets from their category folders and provides:
 *
 * 1. widgets array - Flat array of all widget classes
 * 2. widgetRegistry - Map of widget.id → widget class for O(1) lookup
 * 3. categories - Map of category name → array of widgets in that category
 * 4. Helper functions for querying and filtering widgets
 *
 * WIDGET CATEGORIES:
 * - Primitive: Basic building blocks (Button, Badge, Avatar, Chip, etc.)
 * - Input: Form input controls (Search, Color, Date, File, etc.)
 * - Form: Form elements (Checkbox, Radio, Switch, Select, etc.)
 * - Layout: Layout containers (Card, Grid, Panel, Divider, etc.)
 * - Navigation: Navigation components (Menu, Tabs, Sidebar, etc.)
 * - DataViews: Data presentation (List, Table, Tree, etc.)
 * - Feedback: User feedback (Alert, Toast, Spinner, etc.)
 *
 * WIDGET PATTERN:
 * Each widget class MUST have:
 * - static id: Unique string identifier (e.g., 'button')
 * - static name: Display name (e.g., 'Button')
 * - static category: Category name (e.g., 'primitive')
 * - static icon: Emoji or icon for UI display
 * - static description: Short description of widget purpose
 * - static tags: Array of searchable tags
 * - static dependencies: Array of required widget IDs
 * - static getDefaultOptions(): Returns default configuration object
 * - static stories(): Returns named story configurations for showcase
 * - constructor(id, options): Initializes widget instance
 *
 * CREATING WIDGETS:
 * - WidgetClass.create(container, options) builds an instance and, when a
 *   container element is given, renders it into that container
 * - new WidgetClass(id, options) builds an instance without rendering
 * - Use widgetRegistry.get(id) to find widget class by ID
 */

// Primitive widgets
import { Avatar } from './Primitive/Avatar.js';
import { Badge } from './Primitive/Badge.js';
import { Button as PrimitiveButton } from './Primitive/Button.js';
import { Chip } from './Primitive/Chip.js';
import { Modal } from './Primitive/Modal.js';
import { Panel as PrimitivePanel } from './Primitive/Panel.js';
import { Progress } from './Primitive/Progress.js';
import { Skeleton } from './Primitive/Skeleton.js';
import { Text } from './Primitive/Text.js';
import { Tooltip } from './Primitive/Tooltip.js';
import { Kbd } from './Primitive/Kbd.js';
import { Code } from './Primitive/Code.js';
import { AvatarGroup } from './Primitive/AvatarGroup.js';
import { Popover } from './Primitive/Popover.js';
import { Drawer } from './Primitive/Drawer.js';
import { IconButton } from './Primitive/IconButton.js';
import { RollingNumber } from './Primitive/RollingNumber.js';
import { Spoiler } from './Primitive/Spoiler.js';

// Input widgets
import { Search } from './Input/Search.js';
import { Input as InputField } from './Input/Input.js';
import { Color } from './Input/Color.js';
import { Date } from './Input/Date.js';
import { File } from './Input/File.js';
import { Number } from './Input/Number.js';
import { Range } from './Input/Range.js';
import { Tag } from './Input/Tag.js';
import { Time } from './Input/Time.js';
import { Upload } from './Input/Upload.js';
import { SegmentedControl } from './Input/SegmentedControl.js';
import { PinInput } from './Input/PinInput.js';
import { Password } from './Input/Password.js';
import { Combobox } from './Input/Combobox.js';
import { ColorPicker } from './Input/ColorPicker.js';
import { RangeSlider } from './Input/RangeSlider.js';
import { MultiSelect } from './Input/MultiSelect.js';
import { DatePicker } from './Input/DatePicker.js';
import { Toggle } from './Input/Toggle.js';

// Form widgets
import { Checkbox } from './Form/Checkbox.js';
import { Radio } from './Form/Radio.js';
import { Switch } from './Form/Switch.js';
import { Select } from './Form/Select.js';
import { Textarea } from './Form/Textarea.js';
import { Rating } from './Form/Rating.js';

// Layout widgets
import { Card } from './DataViews/Card.js';
import { Collapse } from './Layout/Collapse.js';
import { Container } from './Layout/Container.js';
import { Divider } from './Layout/Divider.js';
import { Grid } from './Layout/Grid.js';
import { HeaderFooter } from './Layout/HeaderFooter.js';
import { Section } from './Layout/Section.js';
import { Spacer } from './Layout/Spacer.js';
import { SplitPane } from './Layout/SplitPane.js';
import { Stack } from './Layout/Stack.js';
import { Accordion } from './Layout/Accordion.js';
import { Marquee } from './Layout/Marquee.js';

// Navigation widgets
import { Breadcrumb } from './Navigation/Breadcrumb.js';
import { Dropdown } from './Navigation/Dropdown.js';
import { Menu } from './Navigation/Menu.js';
import { Navbar } from './Navigation/Navbar.js';
import { Pagination } from './Navigation/Pagination.js';
import { Sidebar } from './Navigation/Sidebar.js';
import { Stepper } from './Navigation/Stepper.js';
import { Tabs } from './Navigation/Tabs.js';
import { CommandPalette } from './Navigation/CommandPalette.js';
import { Toolbar } from './Navigation/Toolbar.js';
import { Menubar } from './Navigation/Menubar.js';
import { TableOfContents } from './Navigation/TableOfContents.js';
import { SpeedDial } from './Navigation/SpeedDial.js';

// DataViews widgets
import { List } from './DataViews/List.js';
import { ListView } from './DataViews/ListView.js';
import { Table } from './DataViews/Table.js';
import { Tree } from './DataViews/Tree.js';
import { Sparkline } from './DataViews/Sparkline.js';
import { Stat } from './DataViews/Stat.js';
import { Timeline } from './DataViews/Timeline.js';
import { Calendar } from './DataViews/Calendar.js';
import { KeyValue } from './DataViews/KeyValue.js';
import { Carousel } from './DataViews/Carousel.js';
import { ImageView } from './DataViews/Image.js';
import { DonutChart } from './DataViews/DonutChart.js';
import { BarChart } from './DataViews/BarChart.js';
import { ChatThread } from './DataViews/ChatThread.js';

// Feedback widgets
import { Alert } from './Feedback/Alert.js';
import { EmptyState } from './Feedback/EmptyState.js';
import { Spinner } from './Feedback/Spinner.js';
import { Status } from './Feedback/Status.js';
import { Toast } from './Feedback/Toast.js';
import { Banner } from './Feedback/Banner.js';
import { Meter } from './Feedback/Meter.js';
import { ConfirmDialog } from './Feedback/ConfirmDialog.js';
import { Result } from './Feedback/Result.js';

// ============================================================================
// WIDGET REGISTRY
// ============================================================================

export const widgets = [
    // Primitive widgets
    Avatar, Badge, PrimitiveButton, Chip, Modal, PrimitivePanel, Progress, Skeleton, Text, Tooltip,
    Kbd, Code, AvatarGroup, Popover, Drawer, IconButton, RollingNumber, Spoiler,
    
    // Input widgets
    Search, InputField, Color, Date, File, Number, Range, Tag, Time, Upload,
    SegmentedControl, PinInput, Password, Combobox, ColorPicker, RangeSlider, MultiSelect, DatePicker, Toggle,
    
    // Form widgets  
    Checkbox, Radio, Switch, Select, Textarea, Rating,
    
    // Layout widgets
    Card, Collapse, Container, Divider, Grid, HeaderFooter, Section, Spacer, SplitPane, Stack, Accordion, Marquee,
    
    // Navigation widgets
    Breadcrumb, Dropdown, Menu, Navbar, Pagination, Sidebar, Stepper, Tabs, CommandPalette, Toolbar, Menubar, TableOfContents, SpeedDial,
    
    // Feedback widgets
    Alert, EmptyState, Spinner, Status, Toast, Banner, Meter, ConfirmDialog, Result,
    
    // Data view widgets
    List, ListView, Table, Tree, Sparkline, Stat, Timeline, Calendar, KeyValue, Carousel, ImageView, DonutChart, BarChart, ChatThread
];

export const widgetRegistry = new Map();
for (const widget of widgets) {
    widgetRegistry.set(widget.id, widget);
}

// ============================================================================
// WIDGET CATEGORIES
// ============================================================================

export const categories = {
    primitive: { 
        name: 'Primitive', 
        icon: '🎨', 
        description: 'Basic UI building blocks',
        items: [] 
    },
    input: { 
        name: 'Input Controls', 
        icon: '📝', 
        description: 'User input and data entry widgets',
        items: [] 
    },
    form: { 
        name: 'Form Controls', 
        icon: '📋', 
        description: 'Form elements and validation widgets',
        items: [] 
    },
    layout: { 
        name: 'Layout', 
        icon: '📐', 
        description: 'Layout and container widgets',
        items: [] 
    },
    navigation: { 
        name: 'Navigation', 
        icon: '🧭', 
        description: 'Navigation and menu widgets',
        items: [] 
    },
    feedback: { 
        name: 'Feedback', 
        icon: '💬', 
        description: 'User feedback and notification widgets',
        items: [] 
    },
    dataviews: { 
        name: 'Data Views', 
        icon: '📊', 
        description: 'Data display and visualization widgets',
        items: [] 
    }
};

// Populate categories
for (const widget of widgets) {
    if (categories[widget.category]) {
        categories[widget.category].items.push(widget);
    }
}

// ============================================================================
// REGISTRY FUNCTIONS
// ============================================================================

export function getWidget(id) {
    return widgetRegistry.get(id);
}

export function getWidgetsByCategory(category) {
    return categories[category]?.items || [];
}

export function getAllCategories() {
    return Object.entries(categories).map(([id, data]) => ({
        id,
        name: data.name,
        icon: data.icon,
        description: data.description,
        items: data.items,
    }));
}

export function getAllWidgets() {
    return widgets;
}

export function searchWidgets(query) {
    const searchTerm = query.toLowerCase();
    return widgets.filter(widget => 
        widget.name.toLowerCase().includes(searchTerm) ||
        widget.id.toLowerCase().includes(searchTerm) ||
        widget.description?.toLowerCase().includes(searchTerm) ||
        widget.tags?.some(tag => tag.toLowerCase().includes(searchTerm))
    );
}

export function getWidgetsByTag(tag) {
    return widgets.filter(widget => 
        widget.tags?.includes(tag)
    );
}

export function getWidgetDependencies(widgetId) {
    const widget = getWidget(widgetId);
    return widget?.dependencies || [];
}

export function validateWidgetDependencies(widgetId) {
    const dependencies = getWidgetDependencies(widgetId);
    const missing = [];
    
    for (const dep of dependencies) {
        if (!widgetRegistry.has(dep)) {
            missing.push(dep);
        }
    }
    
    return {
        satisfied: missing.length === 0,
        missing,
        dependencies
    };
}

// ============================================================================
// WIDGET CREATION HELPERS
// ============================================================================

export function createWidget(widgetId, container, options = {}) {
    const widget = getWidget(widgetId);
    if (!widget) {
        throw new Error(`Unknown widget: ${widgetId}`);
    }
    
    // Validate dependencies
    const depCheck = validateWidgetDependencies(widgetId);
    if (!depCheck.satisfied) {
        console.warn(`[${widget.name}] Missing dependencies:`, depCheck.missing);
    }
    
    // Call create and handle different return types
    const instance = widget.create(container, options);
    
    // If container is provided and instance wasn't already mounted, mount it now
    if (container && instance) {
        // Detect what type of object was returned and mount appropriately
        if (instance instanceof HTMLElement) {
            // Raw DOM element
            if (!container.contains(instance)) {
                container.appendChild(instance);
            }
        } else if (instance.element instanceof HTMLElement) {
            // Object with .element property (DOM node)
            if (!container.contains(instance.element)) {
                container.appendChild(instance.element);
            }
        } else if (instance.container instanceof HTMLElement) {
            // Object with .container property (DOM node)
            if (!container.contains(instance.container)) {
                container.appendChild(instance.container);
            }
        } else if (instance.appendChild && typeof instance.appendChild === 'function') {
            // UINode-like object (virtual node) - add to container's UINode tree
            if (container.appendChild) {
                container.appendChild(instance);
            }
        }
    }
    
    return instance;
}

export function createWidgetWithTheme(widgetId, container, theme, options = {}) {
    const widget = getWidget(widgetId);
    if (!widget) {
        throw new Error(`Unknown widget: ${widgetId}`);
    }
    
    const themedOptions = {
        theme,
        ...options
    };
    
    return widget.create(container, themedOptions);
}

// ============================================================================
// WIDGET METADATA
// ============================================================================

function describeWidget(widget) {
    return {
        id: widget.id,
        name: widget.name,
        category: widget.category,
        icon: widget.icon,
        description: widget.description,
        tags: widget.tags || [],
        dependencies: widget.dependencies || []
    };
}

export function getWidgetMetadata(widgetId) {
    const widget = getWidget(widgetId);
    return widget ? describeWidget(widget) : null;
}

export function getAllWidgetMetadata() {
    return widgets.map(describeWidget);
}

export function getWidgetDocumentation(widgetId) {
    const widget = getWidget(widgetId);
    if (!widget) return null;
    return {
        ...describeWidget(widget),
        defaultOptions: typeof widget.getDefaultOptions === 'function' ? widget.getDefaultOptions() : {},
        stories: typeof widget.stories === 'function' ? Object.keys(widget.stories()) : []
    };
}

// ============================================================================
// WIDGET STATISTICS
// ============================================================================

export function getWidgetStats() {
    return {
        totalWidgets: widgets.length,
        totalCategories: Object.keys(categories).length,
        widgetsByCategory: Object.entries(categories).map(([id, data]) => ({
            category: id,
            count: data.items.length
        })),
        mostCommonTags: (() => {
            const tagCounts = {};
            for (const widget of widgets) {
                for (const tag of widget.tags || []) {
                    tagCounts[tag] = (tagCounts[tag] || 0) + 1;
                }
            }
            return Object.entries(tagCounts)
                .sort(([,a], [,b]) => b - a)
                .slice(0, 10)
                .map(([tag, count]) => ({ tag, count }));
        })()
    };
}

// ============================================================================
// DEFAULT EXPORTS
// ============================================================================

export default {
    widgets,
    widgetRegistry,
    categories,
    getWidget,
    getWidgetsByCategory,
    getAllCategories,
    getAllWidgets,
    searchWidgets,
    getWidgetsByTag,
    createWidget,
    createWidgetWithTheme,
    getWidgetMetadata,
    getAllWidgetMetadata,
    getWidgetDocumentation,
    getWidgetStats
};
