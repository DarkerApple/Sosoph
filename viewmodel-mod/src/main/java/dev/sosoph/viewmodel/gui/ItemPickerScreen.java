package dev.sosoph.viewmodel.gui;

import java.util.Comparator;
import java.util.function.Consumer;

import dev.sosoph.viewmodel.gui.widget.ActionRow;
import dev.sosoph.viewmodel.gui.widget.ItemRow;
import dev.sosoph.viewmodel.gui.widget.ScrollPanel;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.TextFieldWidget;
import net.minecraft.client.network.ClientPlayerEntity;
import net.minecraft.item.ItemStack;
import net.minecraft.text.Text;

/** A small "which item?" list, used when adding a third person rule. */
public class ItemPickerScreen extends Screen {
    private static final int LIMIT = 300;

    private final Screen parent;
    private final Consumer<ItemIndex.Entry> onPick;

    private String query = "";
    private TextFieldWidget search;
    private ScrollPanel list;

    public ItemPickerScreen(Screen parent, Text title, Consumer<ItemIndex.Entry> onPick) {
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

        this.search = new TextFieldWidget(this.textRenderer, x + 1, top, width - 2, 16, Text.empty());
        this.search.setMaxLength(64);
        this.search.setText(this.query);
        this.search.setChangedListener(text -> {
            this.query = text;
            this.rebuildList();
        });
        this.addDrawableChild(this.search);
        this.setInitialFocus(this.search);

        ClientPlayerEntity player = this.client == null ? null : this.client.player;
        ItemStack held = player == null ? ItemStack.EMPTY : player.getMainHandStack();
        if (!held.isEmpty()) {
            ActionRow useHeld = new ActionRow(width, Text.translatable("viewmodel.button.use_held"), () -> {
                for (ItemIndex.Entry entry : ItemIndex.all()) {
                    if (entry.item() == held.getItem()) {
                        this.pick(entry);
                        return;
                    }
                }
            });
            useHeld.setPosition(x, top + 20);
            useHeld.setHeight(16);
            this.addDrawableChild(useHeld);
            top += 20;
        }

        this.list = new ScrollPanel(x, top + 22, width, bottom - top - 22, 2);
        this.rebuildList();
        this.addDrawableChild(this.list);

        ActionRow cancel = new ActionRow(width, Text.translatable("gui.cancel"), this::close);
        cancel.setPosition(x, this.height - 28);
        cancel.setHeight(18);
        this.addDrawableChild(cancel);
    }

    private void rebuildList() {
        if (this.list == null) {
            return;
        }
        this.list.clear();
        Comparator<ItemIndex.Entry> order = Comparator.comparing(ItemIndex.Entry::name, String.CASE_INSENSITIVE_ORDER);
        for (ItemIndex.Entry entry : ItemIndex.search(this.query, LIMIT, order)) {
            this.list.add(new ItemRow(this.list.rowWidth(), entry.item(), entry.id(), null, Text.empty(),
                    Text.empty(), () -> this.pick(entry)));
        }
    }

    private void pick(ItemIndex.Entry entry) {
        this.onPick.accept(entry);
        this.close();
    }

    @Override
    public void render(DrawContext context, int mouseX, int mouseY, float delta) {
        super.render(context, mouseX, mouseY, delta);
        context.drawCenteredTextWithShadow(this.textRenderer, this.title, this.width / 2, 20, Theme.TEXT);
        if (this.search != null && this.search.getText().isEmpty() && !this.search.isFocused()) {
            context.drawTextWithShadow(this.textRenderer, Text.translatable("viewmodel.blacklist.search"),
                    this.search.getX() + 4, this.search.getY() + 4, Theme.TEXT_OFF);
        }
    }

    @Override
    public void renderBackground(DrawContext context, int mouseX, int mouseY, float delta) {
        context.fill(0, 0, this.width, this.height, 0xB0000000);
    }

    @Override
    public void close() {
        if (this.client != null) {
            this.client.setScreen(this.parent);
        }
    }
}
