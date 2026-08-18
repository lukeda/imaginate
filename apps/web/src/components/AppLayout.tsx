import { AppShell, Burger, Container, Group, NavLink, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconHistory, IconSparkles, IconStack2 } from "@tabler/icons-react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { ColorSchemeToggle } from "./ColorSchemeToggle";

const links = [
  { to: "/", label: "Generate", icon: IconSparkles },
  { to: "/history", label: "History", icon: IconHistory },
  { to: "/models", label: "Models", icon: IconStack2 },
];

export function AppLayout() {
  const [opened, { toggle, close }] = useDisclosure(false);
  const { pathname } = useLocation();

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 220, breakpoint: "sm", collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" gap="sm" justify="space-between">
          <Group gap="sm">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Title order={4}>Imaginate</Title>
          </Group>
          <ColorSchemeToggle />
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        {links.map((link) => (
          <NavLink
            key={link.to}
            component={Link}
            to={link.to}
            label={link.label}
            leftSection={<link.icon size={18} />}
            active={pathname === link.to}
            onClick={close}
          />
        ))}
      </AppShell.Navbar>

      <AppShell.Main>
        <Container size="xl" px={{ base: "xs", sm: "md" }} py="md">
          <Outlet />
        </Container>
      </AppShell.Main>
    </AppShell>
  );
}
