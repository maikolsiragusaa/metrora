import SwiftUI

struct SectionCaption: View {
    let text: String

    var body: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(Theme.brandAccent.opacity(0.7))
                .frame(width: 3, height: 3)
            Text(text)
                .font(.system(size: 11.5, weight: .medium))
                .foregroundStyle(.secondary)
                .tracking(-0.1)
        }
    }
}

/// Collapsible section shell with a clickable caption, optional inline trailing
/// view (e.g. column headers), and a chevron.
struct CollapsibleSection<Trailing: View, Content: View>: View {
    let caption: String
    @Binding var isExpanded: Bool
    let trailing: Trailing
    let content: Content

    init(
        caption: String,
        isExpanded: Binding<Bool>,
        @ViewBuilder trailing: () -> Trailing,
        @ViewBuilder content: () -> Content
    ) {
        self.caption = caption
        self._isExpanded = isExpanded
        self.trailing = trailing()
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Button {
                withAnimation(.easeInOut(duration: 0.18)) {
                    isExpanded.toggle()
                }
            } label: {
                HStack(spacing: 8) {
                    HStack(spacing: 5) {
                        Circle()
                            .fill(Theme.brandAccent.opacity(0.7))
                            .frame(width: 3, height: 3)
                        Text(caption)
                            .font(.system(size: 11.5, weight: .medium))
                            .tracking(-0.1)
                    }
                    Spacer()
                    trailing
                    Image(systemName: "chevron.right")
                        .font(.system(size: 9, weight: .semibold))
                        .rotationEffect(.degrees(isExpanded ? 90 : 0))
                        .opacity(0.55)
                }
                .foregroundStyle(.secondary)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if isExpanded {
                content
                    .transition(.opacity)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
    }
}

extension CollapsibleSection where Trailing == EmptyView {
    init(
        caption: String,
        isExpanded: Binding<Bool>,
        @ViewBuilder content: () -> Content
    ) {
        self.init(caption: caption, isExpanded: isExpanded, trailing: { EmptyView() }, content: content)
    }
}
