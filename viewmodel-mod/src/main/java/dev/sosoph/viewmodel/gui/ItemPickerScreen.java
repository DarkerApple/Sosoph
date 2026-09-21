package dev.sosoph.viewmodel.gui;

import java.util.Comparator;
import java.util.function.Consumer;

import dev.sosoph.viewmodel.gui.widget.ActionRow;
import dev.sosoph.viewmodel.gui.widget.ItemRow;
import dev.sosoph.viewmodel.gui.widget.ScrollPanel;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.network.chat.Component;
import net.minecraft.world.item.ItemStack;

/** A small "which item?" list, used when adding a third person rule. */
public class ItemPickerScreen extends Screen {
    private static final int LIMIT = 300;

    private final Screen parent;
    private final Consumer<ItemIndex.Entry> onPick;

    private String query = "";
    private EditBox search;
    private ScrollPanel list;

    public ItemPickerScreen(Screen parent, Component title, Consumer<ItemIndex.Entry> onPick) {
        super(title);
        this.parent = parent;
        this.onPick = onPick;
    }

    @Override
    protected void init() {
        int width = Math.min(240, this.width - 32);
        int x = (this.width - width) / 2;
        int top = 40;
        int bottom = this.height - 34;

        this.search = new EditBox(this.font, x + 1, top, width - 2, 16, Component.empty());
        this.search.setMaxLength(64);
        this.search.setValue(this.query);
        this.search.setResponder(text -> {
            this.query = text;
            this.rebuildList();
        });
        this.addRenderableWidget(this.search);
        this.setInitialFocus(this.search);

        LocalPlayer player = this.minecraft == null ? null : this.minecraft.player;
        ItemStack held = player == null ? ItemStack.EMPTY : player.getMainHandItem();
        if (!held.isEmpty()) {
            ActionRow useHeld = new ActionRow(width, Component.translatable("viewmodel.button.use_held"), () -> {
                for (ItemIndex.Entry entry : ItemIndex.all()) {
                    if (entry.item() == held.getItem()) {
                        this.pick(entry);
                        return;
                    }
                }
            });
            useHeld.setPosition(x, top + 20);
            useHeld.setHeight(16);
            this.addRenderableWidget(useHeld);
            top += 20;
        }

        this.list = new ScrollPanel(x, top + 22, width, Math.max(40, bottom - top - 22), 2);
        this.rebuildList();
        this.addRenderableWidget(this.list);

        ActionRow cancel = new ActionRow(width, Component.translatable("gui.cancel"), this::onClose);
        cancel.setPosition(x, this.height - 28);
        cancel.setHeight(18);
        this.addRenderableWidget(cancel);
    }

    private void rebuildList() {
        if (this.list == null) {
            return;
        }
        this.list.clear();
        Comparator<ItemIndex.Entry> order = Comparator.comparing(ItemIndex.Entry::name, String.CASE_INSENSITIVE_ORDER);
        for (ItemIndex.Entry entry : ItemIndex.search(this.query, LIMIT, order)) {
            this.list.add(new ItemRow(this.list.rowWidth(), entry.item(), entry.id(), null, Component.empty(),
                    Component.empty(), () -> this.pick(entry)));
        }
    }

    private void pick(ItemIndex.Entry entry) {
        this.onPick.accept(entry);
        this.onClose();
    }

    @Override
    public void extractRenderState(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float delta) {
        graphics.fill(0, 0, this.width, this.height, 0xB0000000);
        super.extractRenderState(graphics, mouseX, mouseY, delta);
        graphics.centeredText(this.font, this.title, this.width / 2, 20, Theme.TEXT);

        if (this.search != null && this.search.getValue().isEmpty() && !this.search.isFocused()) {
            graphics.text(this.font, Component.translatable("viewmodel.blacklist.search"),
                    this.search.getX() + 4, this.search.getY() + 4, Theme.TEXT_OFF);
        }
    }

    @Override
    public void onClose() {
        if (this.minecraft != null) {
            this.minecraft.setScreen(this.parent);
        }
    }
}
