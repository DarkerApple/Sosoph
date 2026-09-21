package dev.sosoph.viewmodel.gui.widget;

import java.util.ArrayList;
import java.util.List;

import dev.sosoph.viewmodel.gui.Theme;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.Drawable;
import net.minecraft.client.gui.Element;
import net.minecraft.client.gui.Selectable;
import net.minecraft.client.gui.screen.narration.NarrationMessageBuilder;
import net.minecraft.client.gui.widget.ClickableWidget;
import net.minecraft.util.math.MathHelper;

/**
 * A clipped, scrolling column of rows.
 *
 * <p>Rows keep their real screen position, so they handle their own mouse events; this
 * only decides where they sit and refuses events that land outside the viewport.
 */
public class ScrollPanel implements Element, Drawable, Selectable {
    private static final int GUTTER = 8;
    private static final int SCROLLBAR_WIDTH = 4;

    private final int x;
    private final int y;
    private final int width;
    private final int height;
    private final int gap;

    private final List<ClickableWidget> rows = new ArrayList<>();

    private double scroll;
    private boolean focused;
    private boolean draggingScrollbar;
    private ClickableWidget focusedRow;
    private ClickableWidget draggedRow;

    public ScrollPanel(int x, int y, int width, int height) {
        this(x, y, width, height, 3);
    }

    public ScrollPanel(int x, int y, int width, int height, int gap) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        this.gap = gap;
    }

    public int rowWidth() {
        return this.width - GUTTER;
    }

    public <T extends ClickableWidget> T add(T row) {
        row.setWidth(this.rowWidth());
        this.rows.add(row);
        return row;
    }

    public void addSpacer(int pixels) {
        this.add(new SpacerRow(this.rowWidth(), pixels));
    }

    public void clear() {
        this.rows.clear();
        this.focusedRow = null;
        this.draggedRow = null;
        this.scroll = 0.0;
    }

    public boolean isEmpty() {
        return this.rows.isEmpty();
    }

    public void scrollToTop() {
        this.scroll = 0.0;
    }

    private int contentHeight() {
        int total = 0;
        for (ClickableWidget row : this.rows) {
            total += row.getHeight() + this.gap;
        }
        return Math.max(0, total - this.gap);
    }

    private double maxScroll() {
        return Math.max(0.0, this.contentHeight() - this.height);
    }

    private void layout() {
        this.scroll = MathHelper.clamp(this.scroll, 0.0, this.maxScroll());
        int cursor = this.y - (int) Math.round(this.scroll);
        for (ClickableWidget row : this.rows) {
            row.setX(this.x);
            row.setY(cursor);
            cursor += row.getHeight() + this.gap;
        }
    }

    private boolean rowVisible(ClickableWidget row) {
        return row.getY() + row.getHeight() > this.y && row.getY() < this.y + this.height;
    }

    @Override
    public void render(DrawContext context, int mouseX, int mouseY, float delta) {
        this.layout();

        boolean inside = this.isMouseOver(mouseX, mouseY);
        int hoverX = inside ? mouseX : Integer.MIN_VALUE;
        int hoverY = inside ? mouseY : Integer.MIN_VALUE;

        context.enableScissor(this.x, this.y, this.x + this.width, this.y + this.height);
        for (ClickableWidget row : this.rows) {
            if (this.rowVisible(row)) {
                row.render(context, hoverX, hoverY, delta);
            }
        }
        context.disableScissor();

        this.renderScrollbar(context);
    }

    private void renderScrollbar(DrawContext context) {
        double max = this.maxScroll();
        if (max <= 0.0) {
            return;
        }
        int trackX = this.x + this.width - SCROLLBAR_WIDTH;
        context.fill(trackX, this.y, trackX + SCROLLBAR_WIDTH, this.y + this.height, 0x33000000);

        int thumbHeight = Math.max(16, (int) ((double) this.height * this.height / this.contentHeight()));
        int thumbY = this.y + (int) ((this.height - thumbHeight) * (this.scroll / max));
        context.fill(trackX, thumbY, trackX + SCROLLBAR_WIDTH, thumbY + thumbHeight, Theme.ACCENT_MUTED);
    }

    private boolean overScrollbar(double mouseX, double mouseY) {
        return this.maxScroll() > 0.0
                && mouseX >= this.x + this.width - GUTTER && mouseX < this.x + this.width
                && mouseY >= this.y && mouseY < this.y + this.height;
    }

    private void scrollToMouse(double mouseY) {
        double fraction = MathHelper.clamp((mouseY - this.y) / (double) this.height, 0.0, 1.0);
        this.scroll = fraction * this.maxScroll();
    }

    @Override
    public boolean isMouseOver(double mouseX, double mouseY) {
        return mouseX >= this.x && mouseX < this.x + this.width
                && mouseY >= this.y && mouseY < this.y + this.height;
    }

    @Override
    public boolean mouseClicked(double mouseX, double mouseY, int button) {
        if (!this.isMouseOver(mouseX, mouseY)) {
            return false;
        }
        if (this.overScrollbar(mouseX, mouseY)) {
            this.draggingScrollbar = true;
            this.scrollToMouse(mouseY);
            return true;
        }
        for (ClickableWidget row : this.rows) {
            if (this.rowVisible(row) && row.mouseClicked(mouseX, mouseY, button)) {
                this.setFocusedRow(row);
                this.draggedRow = row;
                return true;
            }
        }
        this.setFocusedRow(null);
        this.draggedRow = null;
        return true;
    }

    private void setFocusedRow(ClickableWidget row) {
        if (this.focusedRow != null && this.focusedRow != row) {
            this.focusedRow.setFocused(false);
        }
        this.focusedRow = row;
        if (row != null) {
            row.setFocused(true);
        }
    }

    @Override
    public boolean mouseDragged(double mouseX, double mouseY, int button, double deltaX, double deltaY) {
        if (this.draggingScrollbar) {
            this.scrollToMouse(mouseY);
            return true;
        }
        // Only the row the drag started on, so a released drag cannot leave a row armed.
        return this.draggedRow != null && this.draggedRow.mouseDragged(mouseX, mouseY, button, deltaX, deltaY);
    }

    @Override
    public boolean mouseReleased(double mouseX, double mouseY, int button) {
        this.draggingScrollbar = false;
        ClickableWidget row = this.draggedRow;
        this.draggedRow = null;
        return row != null && row.mouseReleased(mouseX, mouseY, button);
    }

    @Override
    public boolean mouseScrolled(double mouseX, double mouseY, double horizontalAmount, double verticalAmount) {
        if (!this.isMouseOver(mouseX, mouseY)) {
            return false;
        }
        // A row under the cursor gets first refusal, so sliders step instead of scrolling.
        for (ClickableWidget row : this.rows) {
            if (this.rowVisible(row) && row.mouseScrolled(mouseX, mouseY, horizontalAmount, verticalAmount)) {
                return true;
            }
        }
        this.scroll = MathHelper.clamp(this.scroll - verticalAmount * 14.0, 0.0, this.maxScroll());
        return true;
    }

    @Override
    public boolean keyPressed(int keyCode, int scanCode, int modifiers) {
        return this.focusedRow != null && this.focusedRow.keyPressed(keyCode, scanCode, modifiers);
    }

    @Override
    public void setFocused(boolean focused) {
        this.focused = focused;
        if (!focused) {
            this.setFocusedRow(null);
        }
    }

    @Override
    public boolean isFocused() {
        return this.focused;
    }

    @Override
    public SelectionType getType() {
        return this.focused ? SelectionType.FOCUSED : SelectionType.NONE;
    }

    @Override
    public void appendNarrations(NarrationMessageBuilder builder) {
    }

    /** Invisible filler used to space sections apart. */
    private static final class SpacerRow extends Row {
        private SpacerRow(int width, int height) {
            super(width, height, net.minecraft.text.Text.empty());
            this.active = false;
        }

        @Override
        protected void renderWidget(DrawContext context, int mouseX, int mouseY, float delta) {
        }

        @Override
        public boolean mouseClicked(double mouseX, double mouseY, int button) {
            return false;
        }
    }
}
