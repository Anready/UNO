import socket
import qrcode
from quart import Quart, render_template

app = Quart(__name__)


def generate_qr(url):
    qr = qrcode.QRCode(version=1, box_size=1, border=1)
    qr.add_data(url)
    qr.make(fit=True)
    # Вывод QR-кода прямо в терминал символами
    qr.print_ascii(invert=True)


def get_ip():
    """GET IPV4 ADDRESS"""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 1))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip


@app.route('/')
async def index():
    return await render_template('index.html')

if __name__ == '__main__':
    local_ip = get_ip()
    port = 3000
    url = f"http://{local_ip}:{port}"

    print("\n" + "="*40)
    print(f"UNO Server is starting!")
    print(f"Address: {url}")
    print("="*40 + "\n")

    print("\nScan QR code to join from mobile:")
    generate_qr(url)
    print("="*40 + "\n")

    app.run(host='0.0.0.0', port=port)
