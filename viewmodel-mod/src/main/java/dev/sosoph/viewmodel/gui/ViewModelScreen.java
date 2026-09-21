package dev.sosoph.viewmodel.gui;

import java.util.ArrayList;
import java.util.List;

import dev.sosoph.viewmodel.config.ConfigManager;
import dev.sosoph.viewmodel.gui.page.AnimationPage;
import dev.sosoph.viewmodel.gui.page.BlacklistPage;
import dev.sosoph.viewmodel.gui.page.ConfigPage;
import dev.sosoph.viewmodel.gui.page.FirstPersonPage;
import dev.sosoph.viewmodel.gui.page.ThirdPersonPage;
import dev.sosoph.viewmodel.gui.widget.ActionRow;
import dev.sosoph.viewmodel.gui.widget.TabButton;
import dev.sosoph.viewmodel.gui.widget.ToggleRow;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.Drawable;
import net.minecraft.client.gui.Element;
import net.minecraft.client.gui.Selectable;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;

/**
 * The whole menu: a narrow panel on the left so the game, and your hands, stay visible
 * on the right while you drag sliders.
 */
public class ViewModelScreen extends Screen {
    private static final int MARGIN = 16;
    private static final int PADDING = 6;
    private static final int FOOTER_HEIGHT = 36;

    /** Remembered between openings so you land back on the page you were tuning. */
    private static int activeTab;

    private final Screen parent;
    private final List<ConfigPage> pages = new ArrayList<>();

    private boolean needsRebuild;
    private int panelX;
    private int panelY;
    private int panelWidth;
    private int panelBottom;

    public ViewModelScreen(Screen parent) {
        super(Text.translatable("viewmodel.title"));
        this.parent = parent;
        this.pages.add(new FirstPersonPage(this));
        this.pages.add(new AnimationPage(this));
        this.pages.add(new ThirdPersonPage(this));
        this.pages.add(new BlacklistPage(this));
    }

    private ConfigPage currentPage() {
        activeTab = Math.max(0, Math.min(activeTab, this.pages.size() - 1));
        return this.pages.get(activeTab);
    }

    /** Pages call this instead of touching the screen's child list directly. */
    public <T extends Element & Drawable & Selectable> T addPageWidget(T widget) {
        return this.addDrawableChild(widget);
    }

    /** Rebuilds the widgets on the next frame, never mid click. */
    public void rebuild() {
        this.needsRebuild = true;
    }

    @Override
    protected void init() {
        ConfigPage page = this.currentPage();

        int available = this.width - MARGIN * 2;
        this.panelWidth = Math.max(160, Math.min(available, page.panelWidth(available)));
        this.panelX = MARGIN;
        this.panelY = 8;
        this.panelBottom = this.height - 8;

        int contentX = this.panelX + PADDING;
        int contentWidth = this.panelWidth - PADDING * 2;
        int contentY = this.panelY + 46;
        int footerY = this.panelBottom - FOOTER_HEIGHT;
        int contentHeight = Math.max(40, footerY - 6 - contentY);

        // Master switch, top right of the header.
        ToggleRow master = new ToggleRow(Math.min(96, contentWidth / 2),
                Text.translatable("viewmodel.option.enabled"),
                () -> ConfigManager.get().enabled, value -> ConfigManager.get().enabled = value);
        master.setPosition(this.panelX + this.panelWidth - PADDING - master.getWidth(), this.panelY + 4);
        master.setHeight(16);
        this.addPageWidget(master);

        // Tabs.
        int tabGap = 2;
        int tabWidth = (contentWidth - tabGap * (this.pages.size() - 1)) / this.pages.size();
        for (int i = 0; i < this.pages.size(); i++) {
            int index = i;
            TabButton tab = new TabButton(tabWidth, this.pages.get(i).getTitle(),
                    () -> activeTab == index, () -> {
                if (activeTab != index) {
                    activeTab = index;
                    this.rebuild();
                }
            });
            tab.setPosition(contentX + i * (tabWidth + tabGap), this.panelY + 26);
            this.addPageWidget(tab);
        }

        // Footer.
        int buttonWidth = (contentWidth - 8) / 3;
        ActionRow resetPage = new ActionRow(buttonWidth, Text.translatable("viewmodel.button.reset_page"), () -> {
            page.resetPage();
            this.rebuild();
        });
        resetPage.setPosition(contentX, footerY);
        this.addPageWidget(resetPage);

        ActionRow resetAll = new ActionRow(buttonWidth, Text.translatable("viewmodel.button.reset_all"),
                Theme.DANGER, () -> {
            ConfigManager.resetAll();
            this.rebuild();
        });
        resetAll.setPosition(contentX + buttonWidth + 4, footerY);
        this.addPageWidget(resetAll);

        ActionRow done = new ActionRow(contentWidth - (buttonWidth + 4) * 2,
                Text.translatable("gui.done"), Theme.ACCENT, this::close);
        done.setPosition(contentX + (buttonWidth + 4) * 2, footerY);
        this.addPageWidget(done);

        page.init(contentX, contentY, contentWidth, contentHeight);
    }

    private void drawChrome(DrawContext context) {
        context.fill(this.panelX, this.panelY, this.panelX + this.panelWidth, this.panelY + 44, Theme.PANEL_HEADER);
        context.fill(this.panelX, this.panelY + 44, this.panelX + this.panelWidth, this.panelBottom, Theme.PANEL);
        context.drawBorder(this.panelX, this.panelY, this.panelWidth, this.panelBottom - this.panelY, Theme.BORDER);

        context.drawTextWithShadow(this.textRenderer, this.title, this.panelX + PADDING, this.panelY + 8, Theme.TEXT);

        Text hint = this.currentPage().getHint();
        String line = hint.getString();
        int maxWidth = this.panelWidth - PADDING * 2;
        if (this.textRenderer.getWidth(line) > maxWidth) {
            line = this.textRenderer.trimToWidth(line, maxWidth);
        }
        context.drawTextWithShadow(this.textRenderer, line, this.panelX + PADDING, this.panelBottom - 14,
                Theme.TEXT_OFF);
    }

    @Override
    public void renderBackground(DrawContext context, int mouseX, int mouseY, float delta) {
        // In a world the game itself is the preview, so it is left untouched.
        if (this.client == null || this.client.world == null) {
            super.renderBackground(context, mouseX, mouseY, delta);
        }
        this.drawChrome(context);
    }

    @Override
    public void render(DrawContext context, int mouseX, int mouseY, float delta) {
        if (this.needsRebuild) {
            this.needsRebuild = false;
            this.clearAndInit();
        }
        super.render(context, mouseX, mouseY, delta);
        this.currentPage().render(context, mouseX, mouseY, delta);
    }

    @Override
    public void tick() {
        this.currentPage().tick();
    }

    @Override
    public boolean shouldPause() {
        // The world has to keep running, otherwise nothing animates while you tune it.
        return false;
    }

    @Override
    public void removed() {
        ConfigManager.save();
    }

    @Override
    public void close() {
        ConfigManager.save();
        if (this.client != null) {
            this.client.setScreen(this.parent);
        }
    }
}
