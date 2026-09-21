package dev.sosoph.viewmodel.gui.page;

import java.util.Comparator;

import dev.sosoph.viewmodel.gui.ItemIndex;
import dev.sosoph.viewmodel.gui.Theme;
import dev.sosoph.viewmodel.gui.ViewModelScreen;
import dev.sosoph.viewmodel.gui.widget.ActionRow;
import dev.sosoph.viewmodel.gui.widget.ItemRow;
import dev.sosoph.viewmodel.gui.widget.LabelRow;
import dev.sosoph.viewmodel.gui.widget.ScrollPanel;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.world.item.ItemStack;
import net.minecraft.network.chat.Component;

/** Items the mod should leave exactly as vanilla draws them. */
public class BlacklistPage extends ConfigPage {
    private static final int LIMIT = 300;
    private static final Component IGNORED = Component.translatable("viewmodel.blacklist.ignored");
    private static final Component MODIFIED = Component.translatable("viewmodel.blacklist.modified");

    private String query = "";
    private EditBox search;
    private ScrollPanel list;

    public BlacklistPage(ViewModelScreen screen) {
        super(screen);
    }

    @Override
    public Component getTitle() {
        return Component.translatable("viewmodel.tab.blacklist");
    }

    @Override
    public int panelWidth(int available) {
        return Math.min(280, available);
    }

    @Override
    public void init(int x, int y, int width, int height) {
        this.search = new EditBox(this.font, x + 1, y, width - 2, 16, Component.empty());
        this.search.setMaxLength(64);
        this.search.setValue(this.query);
        this.search.setResponder(text -> {
            this.query = text;
            this.rebuildList();
        });
        this.screen.addPageWidget(this.search);

        int half = (width - 4) / 2;
        ActionRow addHeld = new ActionRow(half, Component.translatable("viewmodel.button.add_held"), () -> {
            LocalPlayer player = this.minecraft.player;
            if (player != null) {
                ItemStack stack = player.getMainHandItem();
                if (!stack.isEmpty()) {
                    config().setBlacklisted(dev.sosoph.viewmodel.config.ViewModelConfig.idOf(stack.getItem()), true);
                    this.rebuildList();
                }
            }
        });
        addHeld.setPosition(x, y + 20);
        addHeld.setHeight(16);
        this.screen.addPageWidget(addHeld);

        ActionRow clear = new ActionRow(half, Component.translatable("viewmodel.button.clear"), Theme.DANGER, () -> {
            config().blacklist.clear();
            config().invalidate();
            this.rebuildList();
        });
        clear.setPosition(x + half + 4, y + 20);
        clear.setHeight(16);
        this.screen.addPageWidget(clear);

        this.list = new ScrollPanel(x, y + 42, width, Math.max(20, height - 42), 2);
        this.rebuildList();
        this.screen.addPageWidget(this.list);
    }

    private void rebuildList() {
        if (this.list == null) {
            return;
        }
        this.list.clear();
        int rowWidth = this.list.rowWidth();

        this.list.add(new LabelRow(rowWidth,
                Component.translatable("viewmodel.blacklist.count", config().blacklist.size()), true));

        Comparator<ItemIndex.Entry> order = Comparator
                .comparingInt((ItemIndex.Entry entry) -> config().isBlacklisted(entry.id()) ? 0 : 1)
                .thenComparing(ItemIndex.Entry::name, String.CASE_INSENSITIVE_ORDER);

        for (ItemIndex.Entry entry : ItemIndex.search(this.query, LIMIT, order)) {
            this.list.add(new ItemRow(rowWidth, entry.item(), entry.id(),
                    () -> config().isBlacklisted(entry.id()), IGNORED, MODIFIED,
                    () -> {
                        config().toggleBlacklisted(entry.id());
                        config().invalidate();
                    }));
        }
    }

    @Override
    public void extract(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float delta) {
        if (this.search != null && this.search.getValue().isEmpty() && !this.search.isFocused()) {
            graphics.text(this.font, Component.translatable("viewmodel.blacklist.search"),
                    this.search.getX() + 4, this.search.getY() + 4, Theme.TEXT_OFF);
        }
    }

    @Override
    public Component getHint() {
        return Component.translatable("viewmodel.hint.blacklist");
    }

    @Override
    public void resetPage() {
        config().blacklist.clear();
        config().invalidate();
        this.rebuildList();
    }
}
