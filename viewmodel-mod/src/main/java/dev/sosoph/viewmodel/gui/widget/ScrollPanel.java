package dev.sosoph.viewmodel.gui.widget;

import java.util.ArrayList;
import java.util.List;

import dev.sosoph.viewmodel.gui.Compat;
import dev.sosoph.viewmodel.gui.Theme;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.narration.NarrationElementOutput;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;
import net.minecraft.util.Mth;

/**
 * A clipped, scrolling column of rows.
 *
 * <p>Rows keep their real screen position, so they handle their own mouse events; this
 * only decides where they sit and refuses events that land outside the viewport.
 */
public class ScrollPanel extends AbstractWidget {
    private static final int GUTTER = 8;
    private static final int SCROLLBAR_WIDTH = 4;

    private final List<AbstractWidget> rows = new ArrayList<>();
    private final int gap;

    private double scroll;
    private boolean draggingScrollbar;
    private AbstractWidget focusedRow;
    private AbstractWidget draggedRow;

    public ScrollPanel(int x, int y, int width, int height) {
        this(x, y, width, height, 3);
    }

    public ScrollPanel(int x, int y, int width, int height, int gap) {
        super(x, y, width, height, Component.empty());
        this.gap = gap;
    }

    public int rowWidth() {
        return this.getWidth() - GUTTER;
    }

    public <T extends AbstractWidget> T add(T row) {
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

    private int contentHeight() {
        int total = 0;
        for (AbstractWidget row : this.rows) {
            total += row.getHeight() + this.gap;
        }
        return Math.max(0, total - this.gap);
    }

    private double maxScroll() {
        return Math.max(0.0, this.contentHeight() - this.getHeight());
    }

    private void layout() {
        this.scroll = Mth.clamp(this.scroll, 0.0, this.maxScroll());
        int cursor = this.getY() - (int) Math.round(this.scroll);
        for (AbstractWidget row : this.rows) {
            row.setX(this.getX());
            row.setY(cursor);
            cursor += row.getHeight() + this.gap;
        }
    }

    private boolean rowVisible(AbstractWidget row) {
        return row.getY() + row.getHeight() > this.getY() && row.getY() < this.getY() + this.getHeight();
    }

    private boolean inside(double mouseX, double mouseY) {
        return mouseX >= this.getX() && mouseX < this.getX() + this.getWidth()
                && mouseY >= this.getY() && mouseY < this.getY() + this.getHeight();
    }

    @Override
    protected void extractWidgetRenderState(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float delta) {
        this.layout();

        boolean hovering = this.inside(mouseX, mouseY);
        int hoverX = hovering ? mouseX : Integer.MIN_VALUE;
        int hoverY = hovering ? mouseY : Integer.MIN_VALUE;

        graphics.enableScissor(this.getX(), this.getY(), this.getX() + this.getWidth(),
                this.getY() + this.getHeight());
        for (AbstractWidget row : this.rows) {
            if (this.rowVisible(row)) {
                row.extractRenderState(graphics, hoverX, hoverY, delta);
            }
        }
        graphics.disableScissor();

        this.drawScrollbar(graphics);
    }

    private void drawScrollbar(GuiGraphicsExtractor graphics) {
        double max = this.maxScroll();
        if (max <= 0.0) {
            return;
        }
        int trackX = this.getX() + this.getWidth() - SCROLLBAR_WIDTH;
        graphics.fill(trackX, this.getY(), trackX + SCROLLBAR_WIDTH, this.getY() + this.getHeight(), 0x33000000);

        int thumbHeight = Math.max(16, this.getHeight() * this.getHeight() / this.contentHeight());
        int thumbY = this.getY() + (int) ((this.getHeight() - thumbHeight) * (this.scroll / max));
        graphics.fill(trackX, thumbY, trackX + SCROLLBAR_WIDTH, thumbY + thumbHeight, Theme.ACCENT_MUTED);
    }

    private boolean overScrollbar(double mouseX, double mouseY) {
        return this.maxScroll() > 0.0
                && mouseX >= this.getX() + this.getWidth() - GUTTER && mouseX < this.getX() + this.getWidth()
                && mouseY >= this.getY() && mouseY < this.getY() + this.getHeight();
    }

    private void scrollToMouse(double mouseY) {
        double fraction = Mth.clamp((mouseY - this.getY()) / (double) this.getHeight(), 0.0, 1.0);
        this.scroll = fraction * this.maxScroll();
    }

    @Override
    public boolean mouseClicked(MouseButtonEvent click, boolean doubleClick) {
        double mouseX = Compat.mouseX(click);
        double mouseY = Compat.mouseY(click);
        if (!this.inside(mouseX, mouseY)) {
            return false;
        }
        if (this.overScrollbar(mouseX, mouseY)) {
            this.draggingScrollbar = true;
            this.scrollToMouse(mouseY);
            return true;
        }
        for (AbstractWidget row : this.rows) {
            if (this.rowVisible(row) && row.mouseClicked(click, doubleClick)) {
                this.setFocusedRow(row);
                this.draggedRow = row;
                return true;
            }
        }
        this.setFocusedRow(null);
        this.draggedRow = null;
        return true;
    }

    private void setFocusedRow(AbstractWidget row) {
        if (this.focusedRow != null && this.focusedRow != row) {
            this.focusedRow.setFocused(false);
        }
        this.focusedRow = row;
        if (row != null) {
            row.setFocused(true);
        }
    }

    @Override
    public boolean mouseDragged(MouseButtonEvent click, double deltaX, double deltaY) {
        if (this.draggingScrollbar) {
            this.scrollToMouse(Compat.mouseY(click));
            return true;
        }
        // Only the row the drag started on, so a released drag cannot leave a row armed.
        return this.draggedRow != null && this.draggedRow.mouseDragged(click, deltaX, deltaY);
    }

    @Override
    public boolean mouseReleased(MouseButtonEvent click) {
        this.draggingScrollbar = false;
        AbstractWidget row = this.draggedRow;
        this.draggedRow = null;
        return row != null && row.mouseReleased(click);
    }

    @Override
    public boolean mouseScrolled(double mouseX, double mouseY, double horizontalAmount, double verticalAmount) {
        if (!this.inside(mouseX, mouseY)) {
            return false;
        }
        // A row under the cursor gets first refusal, so modified scrolls step values.
        for (AbstractWidget row : this.rows) {
            if (this.rowVisible(row) && row.mouseScrolled(mouseX, mouseY, horizontalAmount, verticalAmount)) {
                return true;
            }
        }
        this.scroll = Mth.clamp(this.scroll - verticalAmount * 14.0, 0.0, this.maxScroll());
        return true;
    }

    @Override
    public boolean keyPressed(KeyEvent input) {
        return this.focusedRow != null && this.focusedRow.keyPressed(input);
    }

    @Override
    protected void updateWidgetNarration(NarrationElementOutput output) {
    }

    /** Invisible filler used to space sections apart. */
    private static final class SpacerRow extends Row {
        private SpacerRow(int width, int height) {
            super(width, height, Component.empty());
            this.active = false;
        }

        @Override
        protected void extractContents(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float delta) {
        }

        @Override
        public boolean mouseClicked(MouseButtonEvent click, boolean doubleClick) {
            return false;
        }
    }
}
