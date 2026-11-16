using System.Buffers.Binary;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Security;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;

namespace CineWall;

internal sealed record Pairing(string Address, int Port, byte[] Secret, byte[] Pin)
{
    [System.Text.Json.Serialization.JsonIgnore]
    public string Code => "CW1-" + Convert.ToBase64String(JsonSerializer.SerializeToUtf8Bytes(this));

    public static Pairing Parse(string code)
    {
        if (code.Length > 512 || !code.StartsWith("CW1-", StringComparison.Ordinal)) throw new FormatException();
        var pair = JsonSerializer.Deserialize<Pairing>(Convert.FromBase64String(code[4..]));
        if (pair is null || !IPAddress.TryParse(pair.Address, out var ip) || !Lan.IsPrivate(ip) ||
            pair.Port is < 1024 or > 65535 || pair.Secret?.Length != 16 || pair.Pin?.Length != 32)
            throw new FormatException();
        return pair;
    }

    public static X509Certificate2 CreateCertificate()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var request = new CertificateRequest("CN=CineWall LAN", key, HashAlgorithmName.SHA256);
        request.CertificateExtensions.Add(new X509BasicConstraintsExtension(false, false, 0, true));
        using var temporary = request.CreateSelfSigned(DateTimeOffset.UtcNow.AddMinutes(-1), DateTimeOffset.UtcNow.AddHours(12));
        // Windows Schannel needs a key it can open. The imported key is removed on dispose.
        byte[] bundle = temporary.Export(X509ContentType.Pfx);
        try { return new X509Certificate2(bundle, (string?)null, X509KeyStorageFlags.UserKeySet); }
        finally { CryptographicOperations.ZeroMemory(bundle); }
    }

    public SslStream OpenPinnedStream(Stream stream) => new(stream, false, (_, certificate, _, _) =>
        certificate is not null && CryptographicOperations.FixedTimeEquals(
            SHA256.HashData(certificate.GetRawCertData()), Pin));

    public bool Authenticates(Hello greeting) => greeting.Secret?.Length == Secret.Length &&
        CryptographicOperations.FixedTimeEquals(Secret, greeting.Secret);
}

internal sealed record Lan(IPAddress Address, int Prefix, string Name)
{
    public override string ToString() => $"{Name} ({Address})";
    public static bool IsPrivate(IPAddress address)
    {
        byte[] b = address.GetAddressBytes();
        return b.Length == 4 && (b[0] == 10 || b[0] == 172 && b[1] is >= 16 and <= 31 || b[0] == 192 && b[1] == 168);
    }

    public bool Includes(IPAddress peer)
    {
        if (!IsPrivate(peer) || Prefix is < 8 or > 32) return false;
        uint mask = uint.MaxValue << (32 - Prefix);
        return (BinaryPrimitives.ReadUInt32BigEndian(Address.GetAddressBytes()) & mask) ==
            (BinaryPrimitives.ReadUInt32BigEndian(peer.GetAddressBytes()) & mask);
    }

    public static Lan[] Available() => NetworkInterface.GetAllNetworkInterfaces()
        .Where(nic => nic.OperationalStatus == OperationalStatus.Up &&
            nic.NetworkInterfaceType is NetworkInterfaceType.Wireless80211 or NetworkInterfaceType.Ethernet)
        .SelectMany(nic => nic.GetIPProperties().UnicastAddresses
            .Where(unicast => IsPrivate(unicast.Address) && unicast.PrefixLength is >= 8 and <= 32)
            .Select(unicast => new Lan(unicast.Address, unicast.PrefixLength, nic.Name)))
        .OrderBy(item => item.Name, StringComparer.OrdinalIgnoreCase).ToArray();
}

internal static class Wire
{
    public static async Task<byte[]> Read(Stream stream, int maximum, CancellationToken cancel)
    {
        byte[] header = new byte[4];
        await stream.ReadExactlyAsync(header, cancel);
        int length = BinaryPrimitives.ReadInt32BigEndian(header);
        if (length <= 0 || length > maximum) throw new InvalidDataException("Invalid CineWall message size.");
        byte[] data = new byte[length];
        await stream.ReadExactlyAsync(data, cancel);
        return data;
    }

    public static async Task Write(Stream stream, byte[] data, CancellationToken cancel)
    {
        byte[] header = new byte[4];
        BinaryPrimitives.WriteInt32BigEndian(header, data.Length);
        await stream.WriteAsync(header, cancel);
        await stream.WriteAsync(data, cancel);
    }

    public static async Task<T> ReadJson<T>(Stream stream, int maximum, CancellationToken cancel) =>
        JsonSerializer.Deserialize<T>(await Read(stream, maximum, cancel)) ?? throw new InvalidDataException("Missing CineWall message.");

    public static Task WriteJson<T>(Stream stream, T value, CancellationToken cancel) =>
        Write(stream, JsonSerializer.SerializeToUtf8Bytes(value), cancel);
}

internal sealed record Hello(byte[] Secret, string Name);
internal sealed record Decision(bool Approved, string Reason, string[]? Monitors = null);
internal sealed record ControlEvent(string Kind, int Code = 0, int X = 0, int Y = 0);
internal sealed record FrameRequest(int Monitor, ControlEvent[] Events);
